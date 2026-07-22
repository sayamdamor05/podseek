import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../"),
  },
  async rewrites() {
    const isDev = process.env.NODE_ENV === 'development';
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'https://podseek-backend.onrender.com';
    return [
      {
        source: '/api/:path*',
        destination: isDev ? 'http://localhost:3001/api/:path*' : `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
