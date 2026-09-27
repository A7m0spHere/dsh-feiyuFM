import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const [pipeName, ...commands] = process.argv.slice(2);
if (!pipeName || !commands.length) throw new Error('Usage: node P0-04-pipe-client.mjs PIPE JSON_COMMAND...');
const socket = net.createConnection(`\\\\.\\pipe\\${pipeName}`);
await once(socket, 'connect');
let buffer = '';
const messages = [];
const waiters = [];
socket.setEncoding('utf8');
socket.on('data', (chunk) => {
  buffer += chunk;
  for (let index; (index = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (waiters.length) waiters.shift()(message);
    else messages.push(message);
  }
});

async function nextMessage() {
  if (messages.length) return messages.shift();
  return new Promise((resolve) => waiters.push(resolve));
}

for (const raw of commands) {
  const command = JSON.parse(raw);
  if (command.type === 'sleep') {
    await delay(command.ms);
    continue;
  }
  socket.write(`${JSON.stringify(command)}\n`);
  while (true) {
    const message = await nextMessage();
    console.log(JSON.stringify(message));
    if (message.type === 'snapshot' || message.type === 'error') break;
  }
}
socket.end();
