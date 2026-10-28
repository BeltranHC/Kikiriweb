// Serves compiled UI with test API fixtures. It never connects to Supabase.
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('.next');
await access(resolve(root, 'BUILD_ID')).catch(() => { throw new Error('Ejecuta npm run build antes de npm run test:ui'); });
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:3108');
    if (url.pathname === '/__health') { response.writeHead(200); response.end('UI fixture server'); return; }
    let file; let contentType;
    if (url.pathname.startsWith('/_next/static/')) {
      file = resolve(root, 'static', decodeURIComponent(url.pathname.slice('/_next/static/'.length)));
      if (!file.startsWith(resolve(root, 'static') + sep)) { response.writeHead(403); response.end(); return; }
      contentType = mime[extname(file)] || 'application/octet-stream';
    } else if (['/', '/dashboard', '/students', '/movements', '/extras', '/import'].includes(url.pathname)) {
      const route = url.pathname === '/' ? 'index' : url.pathname.slice(1);
      const rsc = request.headers.rsc === '1' || url.searchParams.has('_rsc');
      file = resolve(root, 'server/app', `${route}.${rsc ? 'rsc' : 'html'}`);
      contentType = rsc ? 'text/x-component' : 'text/html; charset=utf-8';
    } else { response.writeHead(404); response.end('Fixture route not found'); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); response.end(content);
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
server.listen(3108, '127.0.0.1', () => process.stdout.write('UI fixture server ready on 3108\n'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
