import path from 'node:path';
import { lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';

const outputFolders = { development: '.next-dev', production: '.next' };
export async function prepareNextCache(projectDirectory, mode = 'production') {
  if (!Object.hasOwn(outputFolders, mode)) throw new Error('Modo de limpieza invalido');
  const project = await realpath(projectDirectory);
  const directory = path.join(project, outputFolders[mode]);
  let entry;
  try { entry = await lstat(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory() || await realpath(directory) !== directory)) {
    throw new Error('No se limpiara la cache: se esperaba una carpeta generada, sin enlaces.');
  }
  if (!entry) await mkdir(directory);
  // Keep the folder itself: deleting it would erase Dropbox's per-folder ignore marker.
  for (const name of await readdir(directory)) {
    const target = path.join(directory, name);
    if (path.dirname(target) !== directory) throw new Error('Ruta de cache fuera del directorio permitido');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  const insideDropbox = project.split(path.sep).some(part => /^Dropbox(?: \(.+\))?$/i.test(part));
  if (process.platform === 'win32' && insideDropbox) {
    // Windows alternate data stream documented by Dropbox. Applies only to generated output.
    try { await writeFile(`${directory}:com.dropbox.ignored`, '1'); }
    catch (error) { throw new Error(`No se pudo excluir la cache de Dropbox (${error.code}). Marca la carpeta como disponible sin conexion e intentalo de nuevo.`); }
  }
  return { directory, dropboxIgnored: process.platform === 'win32' && insideDropbox };
}
