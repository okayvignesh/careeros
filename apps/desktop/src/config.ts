/**
 * D.4 scaffold: Env-sourced config. Dev defaults point at the local API.
 * In packaged builds the installer provides CAREEROS_API_URL via a user-visible
 * settings panel (deferred to D.6).
 *
 * ponytail: single env read, no dotenv file plumbing. Add a settings-pane
 * wire-up when D.6 (packaging) needs it; today's dev loop uses shell env.
 */

export interface DesktopConfig {
  apiUrl: string;
  wssUrl: string;
  agentVersion: string;
  keychainService: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DesktopConfig {
  const apiUrl = env.CAREEROS_API_URL ?? 'http://localhost:3000';
  // WSS lives under the same origin, namespace /agent/ws (see apps/api AgentGateway).
  // socket.io-client takes the origin; the namespace is a path arg to io().
  const wssUrl = env.CAREEROS_WSS_URL ?? apiUrl;
  const agentVersion = env.CAREEROS_AGENT_VERSION ?? '0.0.1';
  const keychainService = env.CAREEROS_KEYCHAIN_SERVICE ?? 'careeros-desktop-agent';
  return { apiUrl, wssUrl, agentVersion, keychainService };
}
