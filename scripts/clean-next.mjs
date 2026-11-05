import { fileURLToPath } from 'node:url';
import { prepareNextCache } from './next-cache.mjs';

if (process.argv[2] && process.argv[2] !== 'development') throw new Error('Modo de limpieza invalido');
const project = fileURLToPath(new URL('../', import.meta.url));
const result = await prepareNextCache(project, process.argv[2] === 'development' ? 'development' : 'production');
console.log('Cache generada de Next.js limpia.');
if (result.dropboxIgnored) console.log('Cache excluida de la sincronizacion de Dropbox.');
