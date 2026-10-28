import { lstat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only Next.js output is removed. Resolve from this file, never from caller input.
// fs.rm uses lstat; Next's cleanup reads OneDrive placeholders as symbolic links.
const outputDirectory = fileURLToPath(new URL('../.next', import.meta.url));

try {
  const entry = await lstat(outputDirectory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error('No se limpiará .next: se esperaba una carpeta generada, sin enlaces.');
  }
  await rm(outputDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  console.log('Caché generada de Next.js limpia.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
