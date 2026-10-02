/**
 * D.8 corporate proxy plumbing. Reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY
 * from the environment and applies them to Electron's default session so
 * every outbound HTTP(S) / WSS call from the agent respects corp policy.
 *
 * ponytail: no Settings UI yet. `applyProxy(session, override)` is the
 * programmatic setter a future apps/web "Advanced" panel can wire into via
 * IPC. The spec defers the UI to the apps/web stream.
 *
 * ponytail: no PAC/WPAD autodiscovery. If a corp needs PAC today they can
 * set `HTTPS_PROXY=http://pac-url/` and most PAC-serving proxies honour the
 * static URL. Add `session.setProxy({mode:'pac_script', pacScript})` when a
 * real user hits this.
 */

export interface ProxyConfig {
  // Priority order: explicit setting > env. Omit for env-only.
  proxyRules?: string;
  proxyBypassRules?: string;
}

export interface SessionLike {
  setProxy(config: { proxyRules?: string; proxyBypassRules?: string }): Promise<void>;
}

/**
 * Pure env parser. Returns the proxyRules/proxyBypassRules Chromium wants
 * (`http=proxy:port;https=proxy:port` + a comma-separated bypass list).
 * Honours both uppercase + lowercase env names since curl/wget read both.
 */
export function parseProxyEnv(env: NodeJS.ProcessEnv = process.env): ProxyConfig | null {
  const pick = (k: string): string | undefined => env[k] || env[k.toLowerCase()];
  const httpProxy = pick('HTTP_PROXY');
  const httpsProxy = pick('HTTPS_PROXY');
  const noProxy = pick('NO_PROXY');
  if (!httpProxy && !httpsProxy && !noProxy) return null;

  const rules: string[] = [];
  if (httpProxy) rules.push(`http=${httpProxy}`);
  if (httpsProxy) rules.push(`https=${httpsProxy}`);
  const cfg: ProxyConfig = {};
  if (rules.length > 0) cfg.proxyRules = rules.join(';');
  if (noProxy) {
    // Chromium wants comma-separated hostnames; convert the "a,b,c" or
    // "a b c" shapes curl accepts into the one Chromium wants.
    cfg.proxyBypassRules = noProxy
      .split(/[,\s]+/)
      .filter(Boolean)
      .join(',');
  }
  return Object.keys(cfg).length > 0 ? cfg : null;
}

/**
 * Apply a proxy config to the given Electron session. Override wins when
 * supplied (future Settings UI); otherwise reads from env.
 */
export async function applyProxy(
  session: SessionLike,
  override?: ProxyConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProxyConfig | null> {
  const cfg = override ?? parseProxyEnv(env);
  if (!cfg) {
    // Reset so a previously-set proxy doesn't linger when env is cleared.
    await session.setProxy({ proxyRules: '', proxyBypassRules: '' });
    return null;
  }
  await session.setProxy({
    proxyRules: cfg.proxyRules ?? '',
    proxyBypassRules: cfg.proxyBypassRules ?? '',
  });
  return cfg;
}
