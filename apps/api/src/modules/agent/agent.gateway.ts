import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AgentService } from './agent.service';

/**
 * D.2 (Wave D / P3.5): WSS endpoint the desktop agent connects to for task
 * push. Auth is JWT bearer on the upgrade — either via
 * `Authorization: Bearer <jwt>` header (default socket.io client behavior)
 * or `auth.token` (`io(url, { auth: { token } })`).
 *
 * Per-device rooms so the dispatcher can `.to('device:<id>').emit(...)`.
 * `agentVersion` may be reported via query string on connect so the server
 * can log stale builds.
 *
 * Ponytail: no reconnection state stored server-side beyond `lastSeenAt` +
 * the AgentSession row. The dispatcher lives in a follow-up slice; this
 * gateway ships the auth + rooming so the agent worker in another stream
 * can call `server.to('device:<id>').emit('task', payload)` and reach the
 * right socket.
 */

const NAMESPACE = '/agent/ws';

@WebSocketGateway({
  namespace: NAMESPACE,
  cors: false,
  transports: ['websocket'],
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('AgentGateway');

  @WebSocketServer()
  server!: Server;

  constructor(private readonly agents: AgentService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = extractToken(client);
    if (!token) {
      this.log.warn('WSS connect rejected: no bearer token');
      client.disconnect(true);
      return;
    }
    try {
      const { deviceId } = await this.agents.verifyBearer(token);
      const agentVersion = typeof client.handshake.query.agentVersion === 'string'
        ? client.handshake.query.agentVersion
        : undefined;
      await client.join(roomFor(deviceId));
      // Stash the deviceId on the socket for later hooks (`disconnect`, message handlers).
      (client.data as { deviceId?: string }).deviceId = deviceId;
      await this.agents.touchDevice(deviceId, agentVersion);
    } catch (err) {
      this.log.warn(`WSS connect rejected: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const deviceId = (client.data as { deviceId?: string }).deviceId;
    if (deviceId) {
      await this.agents.touchDevice(deviceId);
    }
  }

  /**
   * Called by the dispatcher (future slice) to push a queued task to a
   * specific device. Kept on the gateway so the socket.io server instance
   * stays private.
   */
  pushTask(deviceId: string, task: unknown): void {
    this.server.to(roomFor(deviceId)).emit('task', task);
  }
}

function extractToken(client: Socket): string | null {
  // socket.io clients typically pass auth via handshake.auth.token; also
  // accept an Authorization header for curl/testing.
  const auth = client.handshake.auth as { token?: string } | undefined;
  if (auth?.token) return auth.token;
  const header = client.handshake.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return null;
}

function roomFor(deviceId: string): string {
  return `device:${deviceId}`;
}
