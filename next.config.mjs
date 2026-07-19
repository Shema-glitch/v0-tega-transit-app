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
        // Access-Control-Allow-Origin is NOT set here — middleware.ts sets it
        // dynamically per-request (reflecting an allowlisted origin only,
        // see FRONTEND_ORIGIN), so a wildcard here can't reopen the API to
        // any site. Methods/Headers don't vary per-request, so they stay static.
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Methods", value: "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With, Accept, Accept-Version, X-Api-Version, X-Admin-Token" },
        ]
      }
    ]
  }
}

export default nextConfig
