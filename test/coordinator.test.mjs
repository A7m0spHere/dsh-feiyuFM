// P5: coordinating two platforms.
//
// The properties that matter: a track keeps its own platform, one platform's
// failure is reported rather than hidden, and a platform that cannot contribute
// is never presented as "there is nothing new".
import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicStore } from '../src/storage.mjs';
import { FakeProvider } from '../src/fakes.mjs';
import { ProviderRegistry } from '../src/core-host.mjs';
import { describePlatforms, collectDiscovery, resolveOnOwnPlatform, summarizeSeedRuns } from '../src/providers/coordinator.mjs';

const track = (provider, id) => ({ provider, providerTrackId: id, title: `${provider}-${id}` });

/** A registry with both platforms present, in whatever states a test needs. */
function registryWith({ netease = 'authorized', qq = 'authorized', discovery = {}, adapters = {} } = {}) {
  const providers = {};
  for (const [name, status] of [['netease', netease], ['qq', qq]]) {
    if (status === 'absent') continue;
    const fake = new FakeProvider(name);
    fake.setAccount(name, status === 'authorized' ? { status: 'authorized', accountId: `${name}-user` } : { status, reason: `${name} is ${status}` });
    fake.setCapability(name, 'recommendation', discovery[name] ?? { status: 'available' });
    if (adapters[name]?.discovery) {
      fake.getDiscoveryTracks = adapters[name].discovery;
    } else if (discovery[name]?.status === 'available' || discovery[name] === undefined) {
      fake.getDiscoveryTracks = async () => [track(name, 'd1'), track(name, 'd2')];
    }
    providers[name] = fake;
  }
  return new ProviderRegistry({ providers });
}

test('both platforms are described, including the ones that cannot be used', () => {
  const registry = registryWith({ qq: 'login_required' });
  const report = describePlatforms(registry);
  assert.equal(report.platforms.netease.installed, true);
  assert.equal(report.platforms.netease.account.status, 'authorized');
  assert.equal(report.platforms.qq.account.status, 'login_required');
  assert.deepEqual(report.usable, ['netease']);
  assert.equal(report.reason, null);

  const none = describePlatforms(registryWith({ netease: 'expired', qq: 'login_required' }));
  assert.deepEqual(none.usable, []);
  assert.match(none.reason, /no platform is signed in/, 'an unusable pair must say so');
});

test('an uninstalled adapter is reported as uninstalled, not as a failure to find music', () => {
  const report = describePlatforms(registryWith({ qq: 'absent' }));
  assert.equal(report.platforms.qq.installed, false);
  assert.match(report.platforms.qq.account.reason, /not installed/);
});

test('discovery collects from every usable platform and keeps platforms apart', async () => {
  const registry = registryWith();
  const result = await collectDiscovery({ registry, limit: 10 });
  assert.deepEqual(result.tracks.map((t) => t.provider).sort(), ['netease', 'netease', 'qq', 'qq']);
  assert.equal(result.reason, null);
  assert.deepEqual(result.attempts.map((row) => row.ok), [true, true]);

  // The same id on two platforms stays two distinct tracks.
  const keys = new Set(result.tracks.map((t) => `${t.provider}:${t.providerTrackId}`));
  assert.equal(keys.size, result.tracks.length);
});

test('a platform that cannot contribute is named with its reason', async () => {
  const registry = registryWith({
    qq: 'login_required',
    discovery: { netease: { status: 'available' } },
  });
  const result = await collectDiscovery({ registry });
  const qqAttempt = result.attempts.find((row) => row.provider === 'qq');
  assert.equal(qqAttempt.ok, false);
  assert.match(qqAttempt.reason, /not signed in/);
  assert.equal(result.tracks.every((t) => t.provider === 'netease'), true);
  assert.equal(result.reason, null, 'one platform succeeding is still a usable pool');
});

test('an empty discovery pool explains itself instead of looking like "nothing new"', async () => {
  const registry = registryWith({
    netease: 'login_required',
    qq: 'login_required',
  });
  const result = await collectDiscovery({ registry });
  assert.deepEqual(result.tracks, []);
  assert.match(result.reason, /netease: not signed in/);
  assert.match(result.reason, /qq: not signed in/);
});

test('a platform whose recommendation surface is unavailable is reported, not skipped', async () => {
  const registry = registryWith({
    discovery: {
      netease: { status: 'available' },
      qq: { status: 'unavailable', reason: 'the recommendation surface is not implemented yet' },
    },
  });
  const result = await collectDiscovery({ registry });
  const qqAttempt = result.attempts.find((row) => row.provider === 'qq');
  assert.equal(qqAttempt.ok, false);
  assert.match(qqAttempt.reason, /not implemented yet/);
  assert.equal(result.tracks.every((t) => t.provider === 'netease'), true);
});

test('a platform returning another platform\'s track is refused', async () => {
  const registry = registryWith({
    adapters: { netease: { discovery: async () => [track('qq', 'smuggled')] } },
  });
  const result = await collectDiscovery({ registry });
  const neteaseAttempt = result.attempts.find((row) => row.provider === 'netease');
  assert.equal(neteaseAttempt.ok, false);
  assert.match(neteaseAttempt.reason, /returned a qq track/);
  assert.equal(result.tracks.some((t) => t.providerTrackId === 'smuggled'), false);
});

test('resolution uses only the track\'s own platform', async () => {
  const registry = registryWith({ qq: 'login_required' });
  const resolved = await resolveOnOwnPlatform({ registry, track: track('netease', 'n1') });
  assert.equal(resolved.handle, 'fake:netease:n1');

  // QQ failing must not affect NetEase, and must not fall back to NetEase.
  await assert.rejects(
    () => resolveOnOwnPlatform({ registry, track: track('qq', 'q1') }),
    (error) => {
      assert.equal(error.code, 'login_required');
      assert.match(error.message, /qq is not signed in/);
      return true;
    },
  );

  await assert.rejects(
    () => resolveOnOwnPlatform({ registry, track: track('qq', 'q1'), options: {} }),
    { code: 'login_required' },
  );

  const absent = registryWith({ qq: 'absent' });
  await assert.rejects(() => resolveOnOwnPlatform({ registry: absent, track: track('qq', 'q1') }), { code: 'provider_unavailable' });
  await assert.rejects(() => resolveOnOwnPlatform({ registry, track: { provider: 'spotify', providerTrackId: 'x' } }), { code: 'invalid_track' });
});

test('seed runs are summarized per platform, and one failure is partial rather than total', () => {
  const partial = summarizeSeedRuns([
    { provider: 'netease', ok: true, source: 'recent', imported: 120, requested: 300, degraded: true, reason: 'Requested 300, imported 120' },
    { provider: 'qq', ok: false, code: 'provider_failure', message: 'no seed source was usable', requested: 300 },
  ]);
  assert.deepEqual(partial.succeeded, ['netease']);
  assert.deepEqual(partial.failed, ['qq']);
  assert.equal(partial.totalImported, 120);
  assert.equal(partial.partial, true, 'one platform working is a usable, degraded result');
  assert.match(partial.reason, /qq could not be imported/);
  // Each platform keeps its own source: QQ's trouble says nothing about NetEase.
  assert.equal(partial.perPlatform.netease.source, 'recent');
  assert.equal(partial.perPlatform.qq.source, null);

  const both = summarizeSeedRuns([
    { provider: 'netease', ok: true, source: 'liked', imported: 40, requested: 300 },
    { provider: 'qq', ok: true, source: 'recent', imported: 30, requested: 300 },
  ]);
  assert.equal(both.partial, false);
  assert.equal(both.reason, null);
  assert.equal(both.totalImported, 70);

  const none = summarizeSeedRuns([{ provider: 'netease', ok: false, code: 'login_required', message: 'sign in first', requested: 300 }]);
  assert.deepEqual(none.succeeded, []);
  assert.equal(none.partial, false);
  assert.equal(none.totalImported, 0);
});