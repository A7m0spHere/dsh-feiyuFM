// Development-only harness. No accounts, audio or production data.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientBundle } from './client-bundle.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const value = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--react-root')) throw new Error('Pass --react-root <existing node_modules with React 18 UMD builds>');
const reactRoot = resolve(value('--react-root'));
const port = process.argv.includes('--port') ? Number(value('--port')) : 4179;
buildClientBundle();
const routes = new Map([
  ['/', [join(root, 'prototypes', 'fishfm-ui-preview.html'), 'text/html']],
  ['/react.js', [join(reactRoot, 'react', 'umd', 'react.development.js'), 'text/javascript']],
  ['/react-dom.js', [join(reactRoot, 'react-dom', 'umd', 'react-dom.development.js'), 'text/javascript']],
  ['/client.js', [join(root, 'src', 'ui', 'dsh-client.js'), 'text/javascript']],
]);
for (const name of ['whale-idle', 'whale-dj', 'whale-listening', 'whale-loop-still']) routes.set(`/fishfm/assets/${name}.png`, [join(root, 'src', 'ui', 'assets', `${name}.png`), 'image/png']);
routes.set('/fishfm/assets/whale-listening-loop.gif', [join(root, 'src', 'ui', 'assets', 'whale-listening-loop.gif'), 'image/gif']);
const server = createServer((req, res) => {
  const route = routes.get(new URL(req.url, 'http://localhost').pathname);
  if (!route || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try { const data = readFileSync(route[0]); res.writeHead(200, { 'content-type': route[1], 'cache-control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : data); }
  catch { res.writeHead(500); res.end('Preview asset unavailable'); }
});
server.listen(port, '127.0.0.1', () => console.log(`FishFM preview http://127.0.0.1:${port} pid=${process.pid}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
