/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Amplify Gen 2 configuration
  env: {
    // Environment variables will be injected by Amplify
  },
};

module.exports = nextConfig;