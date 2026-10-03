// Provider registry. Explicit register() from the composition root (Nest bootstrap
// wires DeepSeek here). No filesystem scan, no dynamic imports — that path is a
// well-known source of surprise loads and CVE surface.

import type { AIProvider, ProviderCapabilities } from './provider';

export type ProviderFactory = () => AIProvider;

export interface ProviderInfo {
  name: string;
  capabilities: ProviderCapabilities;
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();
  // Cached instances so `resolve` returns a stable object per name. Providers
  // are cheap to construct today, but the setup wizard hits `resolve` repeatedly
  // and re-running constructor-time SSRF shape checks is wasted work.
  private readonly instances = new Map<string, AIProvider>();

  register(name: string, factory: ProviderFactory): void {
    if (!name) throw new Error('provider name required');
    if (this.factories.has(name)) {
      throw new Error(`provider "${name}" already registered`);
    }
    this.factories.set(name, factory);
  }

  /** True when a name is already registered; used by idempotent bootstrap. */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  resolve(name: string): AIProvider {
    const cached = this.instances.get(name);
    if (cached) return cached;
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`provider "${name}" not registered`);
    }
    const instance = factory();
    this.instances.set(name, instance);
    return instance;
  }

  list(): ProviderInfo[] {
    const seen = new Set<string>();
    const out: ProviderInfo[] = [];
    for (const name of this.factories.keys()) {
      if (seen.has(name)) continue;
      seen.add(name);
      // list() must not construct providers eagerly (constructors validate URL
      // shape + read config); build lazily via resolve() only when caller asks.
      out.push({ name, capabilities: this.resolve(name).capabilities });
    }
    return out;
  }

  /** Test hook. Not for production wiring. */
  clear(): void {
    this.factories.clear();
    this.instances.clear();
  }
}
