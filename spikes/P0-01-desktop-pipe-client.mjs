// Child-side pipe client for the F1 desktop probe. Connects to a same-user
// local pipe, sends one line, prints the reply, exits.
import net from 'node:net';

const [pipeName] = process.argv.slice(2);
if (!pipeName) throw new Error('Usage: node P0-01-desktop-pipe-client.mjs PIPE_NAME');

const socket = net.createConnection(`\\\\.\\pipe\\${pipeName}`);
socket.setEncoding('utf8');
let buffer = '';
socket.on('data', (chunk) => {
  buffer += chunk;
  const index = buffer.indexOf('\n');
  if (index < 0) return;
  console.log(buffer.slice(0, index).trim());
  socket.end();
});
socket.on('error', (error) => {
  console.log(JSON.stringify({ ok: false, code: error.code ?? 'error' }));
  process.exitCode = 1;
});
socket.on('connect', () => socket.write(`${JSON.stringify({ hello: 'fishfm-p0' })}\n`));