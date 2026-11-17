// Isolated real-account probe. Prints safe results and an expiring QR image.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicStore } from '../../src/storage.mjs';
import { createPlatformCredentials } from '../../src/providers/credentials.mjs';
import { createQQProvider } from '../../src/providers/qq.mjs';
import { createQQCommunityTransport } from '../../src/providers/qq-transport.mjs';
import { createPlayback } from '../../src/core-host.mjs';

const index = process.argv.indexOf('--out');
if (index < 0 || !process.argv[index + 1]) throw new Error('Pass --out with a new output directory');
const directory = resolve(process.argv[index + 1]);
await mkdir(directory);
const privateDirectory = join(directory, '.private');
await mkdir(privateDirectory);
const credentials = createPlatformCredentials({ directory: join(privateDirectory, 'credentials') });
let store = new MusicStore(join(privateDirectory, 'music.sqlite'));
const createProvider = () => createQQProvider({ store, credentials, transport: createQQCommunityTransport({ credentials }) });
let provider = createProvider();
let audio;
const report = { runtime: 'serverless-worker', environment: { platform: process.platform, node: process.version }, steps: [] };
function record(step, detail) {
  report.steps.push({ step, ...detail });
  console.log(JSON.stringify({ step, ...detail }));
}
try {
  const login = await provider.beginLogin();
  const image = /^data:image\/png;base64,(.+)$/.exec(login.qrImage ?? '');
  if (!image) throw new Error('QR image is unavailable');
  const imagePath = join(directory, 'qq-login.png');
  await writeFile(imagePath, Buffer.from(image[1], 'base64'));
  record('qr-ready', { imagePath });
  let state;
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await delay(2500);
    state = await provider.pollLogin();
    if (state.status === 'authorized' || state.status === 'expired') break;
  }
  record('login', { status: state?.status ?? 'timeout' });
  if (state?.status === 'authorized') {
    const imported = await provider.getSeedTracks({ limit: 150 });
    record('import', { source: imported.source, imported: imported.imported, requested: imported.requested });
    const search = await provider.search('周杰伦 稻香');
    record('search', { count: search.tracks.length });
    let track;
    let resource;
    for (const candidate of [...search.tracks.slice(0, 2), ...imported.tracks.slice(0, 3)]) {
      try { resource = await provider.resolve(candidate); track = candidate; break; }
      catch (error) { record('resolve-attempt', { code: error.code ?? 'provider_failure' }); }
    }
    record('resolve', { playable: Boolean(resource) });
    if (resource) {
      audio = await createPlayback({ mode: 'real' });
      const events = [];
      audio.playback.onEvent(event => { if (event.type === 'progress') events.push(event.positionMs); });
      await audio.playback.load({ resource, playInstanceId: 'qq-live-probe', version: 1, muted: true });
      await audio.playback.setMuted({ muted: true, version: 1 });
      await audio.playback.play({ playInstanceId: 'qq-live-probe', version: 1 });
      await delay(4000);
      record('muted-playback', { progressMs: Math.max(0, ...events) });
      await audio.playback.pause({ version: 2 });
      record('pause', { completed: true });
      const lyrics = await provider.lyrics(track);
      record('lyrics', { status: lyrics.status, lines: lyrics.lines.length });
    }
    const discovery = await provider.getDiscoveryTracks({ limit: 12 });
    record('recommendations', { count: discovery.length });
    await provider.dispose();
    store.close();
    store = new MusicStore(join(privateDirectory, 'music.sqlite'));
    provider = createProvider();
    const restored = await provider.restore();
    record('restart-restore', { status: restored.status });
  }
} catch (error) {
  record('error', { code: /^[\w-]{1,80}$/.test(error.code ?? '') ? error.code : 'probe_failed' });
  process.exitCode = 1;
} finally {
  await audio?.dispose();
  await provider.dispose();
  store.close();
  await writeFile(join(directory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  credentials.delete('fishfm/qq');
  credentials.delete('fishfm/qq-runtime');
  await rm(join(directory, 'qq-login.png'), { force: true });
  // The path is a fixed child of the explicitly selected, newly created output.
  await rm(privateDirectory, { recursive: true, force: true });
}
