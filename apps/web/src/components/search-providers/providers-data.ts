/**
 * Zod boundary for the search-provider endpoints. Envelopes are
 * `{ providers }` / `{ workloads }`; a malformed payload throws so the panel
 * can show the explicit unavailable state instead of a half-rendered list.
 */
import {
  SearchProviderSchema,
  SearchProviderWorkloadsResponseSchema,
  SearchProvidersResponseSchema,
  type SearchProvider,
  type SearchProviderWorkload,
} from '@careeros/shared';

export function providersView(value: unknown): SearchProvider[] {
  return SearchProvidersResponseSchema.parse(value).providers;
}

/** Parse a single-provider response (`PUT /me/search-providers/:id`). */
export function providerView(value: unknown): SearchProvider {
  return SearchProviderSchema.parse(value);
}

export function workloadsView(value: unknown): SearchProviderWorkload[] {
  return SearchProviderWorkloadsResponseSchema.parse(value).workloads;
}
