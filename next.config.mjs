import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  allowedDevOrigins: [
    '10.90.125.6',
    '127.0.0.1',
    'localhost',
  ],
};

export default nextConfig;
