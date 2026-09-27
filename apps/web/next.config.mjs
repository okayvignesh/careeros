/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@careeros/ui', '@careeros/shared'],
  typedRoutes: false,
  // No webpack shim needed. `@careeros/shared/schemas` used to transitively
  // pull `node:dns/net` via ./net/assert-public-url; that import was split
  // into ./net/shape (browser-safe, pure JS) + ./net/assert-public-url
  // (server-only, imports node:dns). Schemas now import only from ./net/shape.
  // Works with both `next dev --webpack` and Turbopack.
};

export default nextConfig;
