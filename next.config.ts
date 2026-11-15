import type { NextConfig } from 'next';
import { securityHeaders } from './src/shared/http/security-headers';
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: Object.entries(securityHeaders).map(([key, value]) => ({
          key,
          value,
        })),
      },
    ];
  },
};
export default config;
