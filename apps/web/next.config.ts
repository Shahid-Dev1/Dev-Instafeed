import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@instafeed/shared'],
  poweredByHeader: false,
};

export default config;
