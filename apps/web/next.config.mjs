/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@careeros/ui', '@careeros/shared'],
  typedRoutes: false,
  // ponytail: @careeros/shared re-exports server-only `net/*` (uses node:dns,
  // node:net) from its barrel. Webpack 5 in Next 15 refuses unknown `node:`
  // schemes in browser bundles. Replace them with empty-object data-URI
  // modules client-side; the code that uses them is server-only in practice.
  // Upgrade path: split @careeros/shared/net into a `./net` subpath export and
  // drop it from the barrel, then this block can go.
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
