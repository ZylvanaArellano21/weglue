/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@weglue/shared"],
  experimental: {
    typedRoutes: true,
  },
};

module.exports = nextConfig;
