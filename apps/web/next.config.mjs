/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@careeros/ui', '@careeros/shared'],
  typedRoutes: false,
  // No webpack shim needed: @careeros/shared/net (which uses node:dns/net/tls)
  // is a subpath export and is not re-exported from the barrel, so client
  // bundles never resolve those specifiers. Turbopack is default in Next 16.
};

export default nextConfig;
