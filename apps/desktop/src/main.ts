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

import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';
import { join } from 'node:path';
import {
  isAgentPaused,
  pauseAgent,
  resumeAgent,
  type AgentTask,
} from '@careeros/browser-agent';
import { ApiClient } from './api-client';
import { loadConfig } from './config';
import { createKeychain, type Keychain } from './keychain';
import { TaskRunner } from './task-runner';
import { WssClient, type WssStatus } from './wss-client';

const config = loadConfig();
const api = new ApiClient(config.apiUrl);
let keychain: Keychain | null = null;
let wss: WssClient | null = null;
let tray: Tray | null = null;
let pairWindow: BrowserWindow | null = null;
let wssStatus: WssStatus = 'disconnected';

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
      : { label: 'Pause', click: () => { pauseAgent(); refreshTray(); } },
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
    postResult: async (taskId, status, resultJson) => {
      const latest = await getKeychain().load();
      if (!latest) throw new Error('no credentials to post result');
      await api.postTaskResult(latest.jwt, taskId, status, resultJson);
    },
  });
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
  wss?.stop();
  wss = null;
  await getKeychain().clear();
  refreshTray();
});

app.whenReady().then(async () => {
  // On macOS keep the app running when the pair window closes.
  if (process.platform === 'darwin') app.dock?.hide?.();
  tray = new Tray(trayIcon());
  refreshTray();
  tray.on('click', () => createPairWindow());
  await startWssIfPaired();
});

app.on('window-all-closed', () => {
  // Tray-only app: do NOT quit when the pair window closes.
});

app.on('before-quit', () => {
  wss?.stop();
});
