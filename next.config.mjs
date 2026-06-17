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
  async headers() {
    return [
      {
        // Apply permissive CORS to all API routes so any frontend origin
        // (Vite dev, Vercel preview, Render, mobile) is never blocked.
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With, Accept, Accept-Version, X-Api-Version" },
        ]
      }
    ]
  }
}

export default nextConfig
