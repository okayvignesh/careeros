// Server-only egress bootstrap. Node's global `fetch` is backed by undici,
// which ignores HTTP_PROXY/HTTPS_PROXY by default: setting the proxy env vars
// alone does NOT route application traffic through the Squid allowlist. This
// installs an EnvHttpProxyAgent as the process-global dispatcher so every
// global fetch/undici call leaves through the configured proxy.
//
// Imported by apps/api and apps/worker entrypoints only — never by apps/web
// (undici is node-only). security.md item 6 / A-H8.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export interface EgressProxyEnv {
  HTTP_PROXY?: string | undefined;
  HTTPS_PROXY?: string | undefined;
  NO_PROXY?: string | undefined;
  http_proxy?: string | undefined;
  https_proxy?: string | undefined;
  no_proxy?: string | undefined;
}

type Log = (message: string) => void;

const defaultLog: Log = (message) => {
  // Boot-time only; no pino logger exists yet on the api path.
  // eslint-disable-next-line no-console
  console.error(message);
};

function normaliseProxyUrl(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https, got ${parsed.protocol}`);
  }
  return value;
}

/**
 * Route Node global fetch through the HTTP(S) proxy from the environment.
 *
 * Returns true when a proxy agent was installed; false when no proxy is
 * configured (leaving the default dispatcher untouched, e.g. local dev/CI).
 * Throws when a proxy IS configured but cannot be parsed or built, so the
 * process fails to boot instead of silently egressing directly. NO_PROXY is
 * preserved via undici's EnvHttpProxyAgent (comma/space list, `*` wildcard).
 */
export function installEgressProxy(
  env: EgressProxyEnv = process.env,
  log: Log = defaultLog,
): boolean {
  const httpProxyRaw = env.HTTP_PROXY ?? env.http_proxy;
  const httpsProxyRaw = env.HTTPS_PROXY ?? env.https_proxy;
  if (!httpProxyRaw && !httpsProxyRaw) return false;

  try {
    const options: EnvHttpProxyAgent.Options = {};
    const httpProxy = normaliseProxyUrl(httpProxyRaw, 'HTTP_PROXY');
    const httpsProxy = normaliseProxyUrl(httpsProxyRaw, 'HTTPS_PROXY');
    const noProxy = env.NO_PROXY ?? env.no_proxy;
    if (httpProxy) options.httpProxy = httpProxy;
    if (httpsProxy) options.httpsProxy = httpsProxy;
    if (noProxy) options.noProxy = noProxy;
    setGlobalDispatcher(new EnvHttpProxyAgent(options));
    log(
      `[egress] global fetch dispatcher -> proxy (http=${httpProxy ?? '-'}, https=${httpsProxy ?? '-'}, no_proxy=${noProxy ?? '-'})`,
    );
    return true;
  } catch (err) {
    log(
      `[egress] FATAL: proxy configured but EnvHttpProxyAgent failed; refusing to egress directly: ${
        (err as Error).message
      }`,
    );
    throw err;
  }
}
