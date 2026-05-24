/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true, // Enforce Gzip/Brotli
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Added for Turbopack HMR mobile testing
  allowedDevOrigins: ['192.168.1.75'],
  // Added for Render.com zero-config deployment
  output: 'standalone',
}

export default nextConfig
