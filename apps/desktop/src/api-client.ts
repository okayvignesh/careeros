/**
 * D.4 scaffold: tiny HTTPS client the renderer + main process use for
 * pair/complete and task-result POSTs. Uses Node 20's global fetch, no
 * axios. Narrow surface so there's little to maintain.
 *
 * ponytail: no retries + no circuit-breaker; the main-process WSS layer
 * already owns reconnect semantics. Upgrade path: add `@careeros/shared/retry`
 * (already in-tree) around posts if we see transient 5xx storms in prod.
 */

export interface PairCompleteResponse {
  deviceId: string;
  jwt: string;
  refreshToken: string;
  expiresAt: string;
}

export class ApiClient {
  constructor(private readonly apiUrl: string) {}

  async pairComplete(input: {
    code: string;
    deviceName: string;
    publicKey: string;
    agentVersion: string;
    /** `process.platform` — surfaced in web Settings → Devices. */
    platform?: string;
  }): Promise<PairCompleteResponse> {
    const res = await fetch(`${this.apiUrl}/agent/pair/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`pair/complete failed: ${res.status} ${txt}`);
    }
    return (await res.json()) as PairCompleteResponse;
  }

  async postTaskResult(
    jwt: string,
    taskId: string,
    status: 'completed' | 'failed' | 'timeout',
    resultJson: unknown,
  ): Promise<void> {
    const res = await fetch(`${this.apiUrl}/agent/tasks/${taskId}/result`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ status, resultJson }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`task result POST failed: ${res.status} ${txt}`);
    }
  }
}
