/**
 * D.4 scaffold: preload script. The ONLY contextBridge surface for the
 * renderer. Keep it tiny.
 *
 * ponytail: no React, no bundler. The pair window is one HTML file + one
 * TS file transpiled by tsc. Upgrade path: add vite if (and only if) the
 * agent sprouts a dashboard view the user actually opens often.
 */

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  async submitPairingCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return ipcRenderer.invoke('agent:pair', code);
  },
  async getStatus(): Promise<{ paired: boolean; connected: boolean }> {
    return ipcRenderer.invoke('agent:status');
  },
  async revoke(): Promise<void> {
    return ipcRenderer.invoke('agent:revoke');
  },
};

contextBridge.exposeInMainWorld('careeros', api);

export type CareerOsBridge = typeof api;
