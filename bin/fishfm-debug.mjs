import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { MusicStore } from '../src/storage.mjs';
import { MusicCore } from '../src/core.mjs';
import { FakePlayback, FakeProvider } from '../src/fakes.mjs';

const dbIndex = process.argv.indexOf('--db');
const dbPath = dbIndex >= 0 ? process.argv[dbIndex + 1] : ':memory:';
if (!dbPath) throw new Error('--db needs a path');
const store = new MusicStore(dbPath);
const playback = new FakePlayback();
const core = new MusicCore({ store, playback, provider: new FakeProvider() });
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
console.log(JSON.stringify({ help: 'JSON lines: {"queue":[{"provider":"netease","providerTrackId":"1","title":"Demo"}]} or {"type":"next"}; type snapshot, wait, or exit', snapshot: core.snapshot() }));
for await (const line of rl) {
  const input = line.trim();
  if (!input) continue;
  if (input === 'exit') break;
  try {
    if (input === 'wait') await core.waitForIdle();
    else if (input !== 'snapshot') {
      const value = JSON.parse(input);
      if (value.queue) core.setQueue(value.queue);
      else if (value.event) core.onPlaybackEvent(value.event);
      else core.dispatch({ commandId: randomUUID(), ...value });
    }
    console.log(JSON.stringify({ snapshot: core.snapshot(), playback: { playing: playback.playing, muted: playback.muted } }));
  } catch (error) {
    console.log(JSON.stringify({ error: { code: error.code ?? 'invalid_input', message: error.message } }));
  }
}
rl.close();
store.close();
