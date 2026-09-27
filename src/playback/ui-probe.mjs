// Stand-in for a desktop UI process: it attaches to an already-running audio
// host, reads its state, and exits. Used by scripts/playback-smoke.mjs to show
// that playback does not depend on the UI process staying alive.
//
// Usage: node src/playback/ui-probe.mjs <pipeName> [--snapshot]
import { PipeTransport } from './transport.mjs';
import { encodeMessage } from './protocol.mjs';

const [pipeName] = process.argv.slice(2);
if (!pipeName) throw new Error('Usage: node ui-probe.mjs <pipeName>');

const transport = new PipeTransport({ name: pipeName, onMessage: (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
} });

await transport.connect({ timeoutMs: 5000 });
// The host greets a new client on connect; ask for a snapshot as well.
await transport.request({ type: 'snapshot' }, { timeoutMs: 5000 });
await new Promise((resolve) => setTimeout(resolve, 100));
transport.close();