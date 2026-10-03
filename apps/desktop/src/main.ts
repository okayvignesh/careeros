/**
 * D.4 scaffold: Electron main process. Creates a tray + pairing window, wires
 * the keychain, kicks off the WSS client, and routes tasks to the stub
 * runner.
 *
 * What's wired here:
 *   - Tray icon + menu (Pair / Pause / Resume / Quit)
 *   - IPC: agent:pair (code -> pair/complete + save creds + start WSS)
 *   - IPC: agent:status (paired + connected flags)
 *   - IPC: agent:revoke (clear keychain + stop WSS)
 *   - Kill-switch broadcast: tray toggles write/remove the paused file in
 *     @careeros/browser-agent so the server-side dispatcher can respect the
 *     same signal via shared mount.
 *
 * ponytail: no auto-start on boot (deferred to D.8), no auto-update
 * (deferred to D.6), no notarization/signing (phase-3.5 non-goal), no deep
 * app menu (tray is the whole UI). Each belongs on its own stream.
 */

import { app, BrowserWindow, ipcMain, Menu, nativeImage, session, Tray } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';
import { join } from 'node:path';
import {
  defaultAllowlistDir,
  isAgentPaused,
  loadAllowlistDir,
  pauseAgent,
  resumeAgent,
  type AgentTask,
  type AllowlistEntry,
  type FormFillPayload,
} from '@careeros/browser-agent';
import { ApiClient } from './api-client';
import { loadConfig } from './config';
import { createKeychain, type Keychain } from './keychain';
import { applyProxy } from './proxy';
import { startCleanupScheduler } from './screenshot-cleanup';
import { startRotationScheduler } from './log-rotation';
import { startUpdater } from './updater';
import { TaskRunner, type TaskResult } from './task-runner';
import { WssClient, type WssStatus } from './wss-client';

const config = loadConfig();
const api = new ApiClient(config.apiUrl);
let keychain: Keychain | null = null;
let wss: WssClient | null = null;
let tray: Tray | null = null;
let pairWindow: BrowserWindow | null = null;
let wssStatus: WssStatus = 'disconnected';
let activeRunner: TaskRunner | null = null;

// ponytail: allowlist loaded once at pair-time. Upgrade path: refresh on a
// signal from the server (e.g. a 'allowlist-updated' WSS event) so operators
// can roll new entries without a restart.
let allowlistCache: Map<string, AllowlistEntry> | null = null;
function getAllowlist(): Map<string, AllowlistEntry> {
  if (!allowlistCache) {
    try {
      allowlistCache = loadAllowlistDir(defaultAllowlistDir());
    } catch (err) {
      console.warn(`allowlist: load failed (${(err as Error).message}); starting empty`);
      allowlistCache = new Map();
    }
  }
  return allowlistCache;
}

// ponytail: default payload is empty; the server embeds the real candidate
// payload on `task.params.payload` per-task so the desktop never caches PII.
// Upgrade path: pull from an authenticated /me endpoint on pair and cache in
// the keychain when F.1 approvals need offline operation.
const defaultPayload: FormFillPayload = {};

function mapResultStatus(s: TaskResult['status']): 'completed' | 'failed' | 'timeout' {
  if (s === 'ok') return 'completed';
  // 'failed' | 'selector-broken' | 'killed' all surface as 'failed' at the
  // Prisma status column; the resultJson carries the finer failureReason.
  return 'failed';
}

function getKeychain(): Keychain {
  if (!keychain) keychain = createKeychain(config.keychainService);
  return keychain;
}

function createPairWindow(): BrowserWindow {
  if (pairWindow && !pairWindow.isDestroyed()) {
    pairWindow.focus();
    return pairWindow;
  }
  const win = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    title: 'Career OS Agent',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(join(__dirname, 'renderer', 'pair.html'));
  win.on('closed', () => {
    pairWindow = null;
  });
  pairWindow = win;
  return win;
}

function trayMenu(): Menu {
  const paused = isAgentPaused();
  const connectedLabel = `WSS: ${wssStatus}`;
  return Menu.buildFromTemplate([
    { label: 'Career OS Agent', enabled: false },
    { label: connectedLabel, enabled: false },
    { type: 'separator' },
    { label: 'Pair device', click: () => createPairWindow() },
    paused
      ? { label: 'Resume', click: () => { resumeAgent(); refreshTray(); } }
      : { label: 'Pause', click: () => { pauseAgent(); activeRunner?.killMidTask(); refreshTray(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(trayMenu());
  tray.setToolTip(`Career OS Agent (${wssStatus}${isAgentPaused() ? ', paused' : ''})`);
}

function trayIcon(): Electron.NativeImage {
  // ponytail: 1x1 transparent PNG so the scaffold runs without a bundled
  // asset today. Upgrade path: ship real tray assets (16/32@1x+2x) under
  // apps/desktop/assets/ when D.6 packaging work starts.
  try {
    const png = readFileSync(join(__dirname, '..', 'assets', 'tray.png'));
    const img = nativeImage.createFromBuffer(png);
    if (!img.isEmpty()) return img;
  } catch {
    // fall through to empty image
  }
  return nativeImage.createEmpty();
}

async function startWssIfPaired(): Promise<void> {
  const creds = await getKeychain().load();
  if (!creds) return;
  const runner = new TaskRunner({
    isPaused: () => isAgentPaused(),
    userDataDir: app.getPath('userData'),
    allowlist: getAllowlist(),
    payload: defaultPayload,
    postResult: async (result) => {
      const latest = await getKeychain().load();
      if (!latest) throw new Error('no credentials to post result');
      await api.postTaskResult(
        latest.jwt,
        result.taskId,
        mapResultStatus(result.status),
        result,
      );
    },
  });
  activeRunner = runner;
  wss?.stop();
  wss = new WssClient({
    wssUrl: config.wssUrl,
    agentVersion: config.agentVersion,
    getToken: async () => (await getKeychain().load())?.jwt ?? null,
    onTask: (task: AgentTask) => {
      void runner.handle(task);
    },
    onStatus: (s) => {
      wssStatus = s;
      refreshTray();
    },
  });
  await wss.start();
}

ipcMain.handle('agent:pair', async (_evt, code: string) => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return { ok: false as const, error: 'Enter the 6-digit pairing code' };
  }
  try {
    // ponytail: publicKey is a random 32-byte blob today; D.7 (JWT rotation)
    // will upgrade this to an actual ed25519 keypair the server verifies on
    // every WSS message. For D.4 the server accepts any <=4096-byte blob.
    const publicKey = randomBytes(32).toString('base64');
    const deviceName = `${hostname()}-${platform()}`.slice(0, 128);
    const res = await api.pairComplete({
      code: code.trim(),
      deviceName,
      publicKey,
      agentVersion: config.agentVersion,
      platform: platform(),
    });
    await getKeychain().save({
      deviceId: res.deviceId,
      jwt: res.jwt,
      refreshToken: res.refreshToken,
    });
    await startWssIfPaired();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  }
});

ipcMain.handle('agent:status', async () => {
  const creds = await getKeychain().load();
  return { paired: !!creds, connected: wssStatus === 'connected' };
});

ipcMain.handle('agent:revoke', async () => {
  activeRunner?.killMidTask();
  wss?.stop();
  wss = null;
  activeRunner = null;
  await getKeychain().clear();
  refreshTray();
});

app.whenReady().then(async () => {
  // On macOS keep the app running when the pair window closes.
  if (process.platform === 'darwin') app.dock?.hide?.();
  // D.8: corporate proxy from HTTP_PROXY / HTTPS_PROXY / NO_PROXY env.
  // Programmatic setter is `applyProxy(session.defaultSession, override)` once
  // a Settings UI exists (apps/web stream owns the UI; this is the hook).
  try {
    await applyProxy(session.defaultSession);
  } catch (err) {
    console.warn(`proxy: setProxy failed (${(err as Error).message})`);
  }
  // D.8: daily screenshot retention + hourly log rotation check. Both tick
  // without unref so Electron's main loop stays alive for them.
  startCleanupScheduler({ dir: join(app.getPath('userData'), 'screenshots') });
  startRotationScheduler({ dir: app.getPath('logs') });
  // D.6: check GitHub Releases on start + every 6h. Prompts user to install
  // via native notification when a newer version downloads.
  startUpdater();
  tray = new Tray(trayIcon());
  refreshTray();
  tray.on('click', () => createPairWindow());
  await startWssIfPaired();
});

app.on('window-all-closed', () => {
  // Tray-only app: do NOT quit when the pair window closes.
});

app.on('before-quit', () => {
  activeRunner?.killMidTask();
  wss?.stop();
});
