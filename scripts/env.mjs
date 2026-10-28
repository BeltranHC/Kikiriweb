import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve('.env.local');
if (existsSync(envPath)) process.loadEnvFile(envPath);
export function requiredEnv(name, alternative) {
  const value = process.env[name] || (alternative && process.env[alternative]);
  if (!value) throw new Error(`Configura ${name} en .env.local`);
  return value;
}
