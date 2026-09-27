/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@careeros/ui', '@careeros/shared'],
  typedRoutes: false,
  // Defensive: with `next dev --webpack` we can't statically prove no code
  // path pulls in node:dns/net/tls on the browser side (transpilePackages +
  // deep transitive imports through unpdf/pdfjs-dist, etc.). Replace those
  // specifiers with empty modules on the client bundle. Server bundle keeps
  // the real modules. Turbopack (no --webpack flag) doesn't need this.
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
