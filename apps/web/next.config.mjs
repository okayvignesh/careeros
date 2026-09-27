/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@careeros/ui', '@careeros/shared'],
  typedRoutes: false,
  // @careeros/shared re-exports ./net from its barrel (packages/ai on
  // moduleResolution=node needs the barrel access; the subpath ./net export
  // isn't reachable from that resolver). schemas/index.ts imports from
  // ./net/shape (browser-safe) so that path is clean, but any client code
  // that pulls from '@careeros/shared' still resolves ./net which imports
  // node:dns/net/tls. Replace those specifiers with empty modules on the
  // client bundle. Server bundle keeps the real modules. Only needed under
  // `--webpack` dev mode; Turbopack ignores this block.
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:(dns|net|tls)$/,
          (resource) => {
            resource.request = 'data:text/javascript,module.exports={}';
          },
        ),
      );
    }
    return config;
  },
};

export default nextConfig;
