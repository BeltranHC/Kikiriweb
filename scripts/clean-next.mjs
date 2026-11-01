import { lstat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only the selected Next.js output folder is removed. Resolve from this file, never from caller input.
// fs.rm uses lstat; Next's cleanup reads OneDrive placeholders as symbolic links.
if (process.argv[2] && process.argv[2] !== 'development') throw new Error('Modo de limpieza inválido');
const folder = process.argv[2] === 'development' ? '.next-dev' : '.next';
const outputDirectory = fileURLToPath(new URL(`../${folder}`, import.meta.url));

try {
  const entry = await lstat(outputDirectory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error('No se limpiará la caché: se esperaba una carpeta generada, sin enlaces.');
  }
  await rm(outputDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  console.log('Caché generada de Next.js limpia.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
