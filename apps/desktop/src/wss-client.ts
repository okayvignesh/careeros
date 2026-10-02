/**
 * D.4 scaffold: WSS client that connects to the API's /agent/ws namespace
 * (socket.io, see apps/api/src/modules/agent/agent.gateway.ts). Auth is JWT
 * bearer via `auth.token` on the handshake. Reconnect uses exponential
 * backoff capped at 60s; the backoff math is pure so it unit-tests cleanly
 * without a real socket.
 *
 * ponytail: no JWT auto-refresh on 401 yet - on disconnect we requeue with
 * backoff and let the user re-pair if their refresh token also died.
 * Upgrade path: wire /agent/pair/refresh on `connect_error` with reason
 * 'auth' before falling back to re-pair. Owned by "task-runner integration".
 */

import type { AgentTask } from '@careeros/browser-agent';

export interface WssClientOptions {
  wssUrl: string;
  namespace?: string;
  getToken: () => Promise<string | null>;
  agentVersion: string;
  onTask: (task: AgentTask) => void;
  onStatus?: (status: WssStatus) => void;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type WssStatus = 'disconnected' | 'connecting' | 'connected' | 'auth-failed';

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 60_000;

/**
 * Pure backoff fn: delay(n) = min(MAX, BASE * 2^n). Exposed so the unit test
 * can lock the ceiling + the doubling without spinning up a socket.
 */
export function reconnectDelayMs(attempt: number, base = BASE_DELAY_MS, max = MAX_DELAY_MS): number {
  if (attempt < 0) return base;
  const raw = base * Math.pow(2, attempt);
  return Math.min(raw, max);
}

export class WssClient {
  private socket: {
    connect(): void;
    disconnect(): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  } | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly opts: WssClientOptions) {
    this.log = opts.logger ?? console;
  }

  async start(): Promise<void> {
    this.closed = false;
    await this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        // ignore: closing an already-closed socket is harmless
      }
      this.socket = null;
    }
    this.opts.onStatus?.('disconnected');
  }

  private async connect(): Promise<void> {
    const token = await this.opts.getToken();
    if (!token) {
      this.opts.onStatus?.('auth-failed');
      this.log.warn('WSS: no token in keychain; skipping connect');
      return;
    }
    this.opts.onStatus?.('connecting');
    // require() so unit tests can run without socket.io-client installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    const namespace = this.opts.namespace ?? '/agent/ws';
    const url = this.opts.wssUrl.endsWith('/') ? this.opts.wssUrl.slice(0, -1) : this.opts.wssUrl;
    const socket = io(`${url}${namespace}`, {
      transports: ['websocket'],
      auth: { token },
      query: { agentVersion: this.opts.agentVersion },
      reconnection: false, // we own reconnect so we can refresh the token first
    });
    this.socket = socket as unknown as typeof this.socket;
    socket.on('connect', () => {
      this.attempt = 0;
      this.opts.onStatus?.('connected');
      this.log.info('WSS: connected');
    });
    socket.on('task', (task: unknown) => {
      try {
        this.opts.onTask(task as AgentTask);
      } catch (err) {
        this.log.error(`WSS: task handler threw: ${(err as Error).message}`);
      }
    });
    socket.on('disconnect', (reason: string) => {
      this.log.warn(`WSS: disconnected (${reason})`);
      this.opts.onStatus?.('disconnected');
      this.scheduleReconnect();
    });
    socket.on('connect_error', (err: Error) => {
      this.log.warn(`WSS: connect error (${err.message})`);
      this.opts.onStatus?.('disconnected');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.log.info(`WSS: reconnecting in ${delay}ms (attempt ${this.attempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
