// P5: coordinating two platforms.
//
// MVP requires both NetEase and QQ, and a user may connect only one of them.
// The rules this module implements:
//   - a track always belongs to the platform it came from; the two are never
//     merged by title, and one platform's failure never causes a track to be
//     relabelled as the other's;
//   - the discovery pool is filled from whichever platforms are usable, and a
//     platform that cannot contribute is reported, not silently skipped;
//   - resolving a track uses only its own platform, so a missing sign-in on one
//     platform cannot break playback of the other.
import { MusicError, trackId } from '../contracts.mjs';
import { PROVIDER_NAMES } from './contract.mjs';

/** Accounts and capabilities for every platform, including unusable ones. */
export function describePlatforms(registry) {
  const platforms = {};
  for (const name of PROVIDER_NAMES) {
    const installed = registry.has(name);
    if (!installed) {
      platforms[name] = {
        installed: false,
        account: { status: 'unavailable', reason: 'the adapter is not installed' },
        capabilities: {},
      };
      continue;
    }
    platforms[name] = {
      installed: true,
      account: registry.getAccount(name),
      capabilities: registry.getCapabilities(name),
    };
  }
  const usable = PROVIDER_NAMES.filter((name) => platforms[name].account?.status === 'authorized');
  return {
    platforms,
    usable,
    // Saying "no platform is usable" is different from "we found nothing".
    reason: usable.length ? null : 'no platform is signed in, so there is nothing to play from',
  };
}

/**
 * Collects discovery candidates from every usable platform.
 *
 * A platform that fails is recorded with its reason so the caller can tell the
 * user which platform is missing, instead of presenting a short list as if it
 * were the whole picture.
 */
export async function collectDiscovery({ registry, limit = 40, signal = null } = {}) {
  const attempts = [];
  const tracks = [];
  const seen = new Set();

  for (const name of PROVIDER_NAMES) {
    if (!registry.has(name)) {
      attempts.push({ provider: name, count: 0, ok: false, reason: 'the adapter is not installed' });
      continue;
    }
    const account = registry.getAccount(name);
    if (account?.status !== 'authorized') {
      attempts.push({ provider: name, count: 0, ok: false, reason: `not signed in (${account?.status ?? 'unknown'})` });
      continue;
    }
    const capability = registry.getCapabilities(name)?.recommendation;
    if (capability && capability.status !== 'available' && capability.status !== 'degraded') {
      attempts.push({ provider: name, count: 0, ok: false, reason: capability.reason ?? capability.status });
      continue;
    }
    try {
      const found = await registry.getDiscoveryTracks(name, { limit, signal });
      const fresh = [];
      for (const track of found ?? []) {
        if (track.provider !== name) {
          // A candidate must stay on its own platform; trusting a mismatched
          // label would create a key that cannot be resolved later.
          throw new MusicError('provider_failure', `${name} returned a ${track.provider} track`);
        }
        const key = trackId(track);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(track);
      }
      tracks.push(...fresh);
      attempts.push({ provider: name, count: fresh.length, ok: true, reason: null });
    } catch (error) {
      attempts.push({ provider: name, count: 0, ok: false, reason: `${error.code ?? 'error'}: ${error.message}` });
    }
  }

  return {
    tracks,
    attempts,
    // Present only when nothing contributed, so a caller cannot mistake an
    // empty pool for "every platform agreed there is nothing new".
    reason: tracks.length ? null : (attempts.map((row) => `${row.provider}: ${row.reason}`).join('; ') || 'no platform is connected'),
  };
}

/**
 * Resolves a track on its own platform. A failure on that platform is reported
 * as such; the coordinator never tries a different platform for the same track,
 * because a different platform is a different recording.
 */
export async function resolveOnOwnPlatform({ registry, track, options = {} }) {
  if (!track || !PROVIDER_NAMES.includes(track.provider)) {
    throw new MusicError('invalid_track', 'A track with a known provider is required');
  }
  if (!registry.has(track.provider)) {
    throw new MusicError('provider_unavailable', `The ${track.provider} adapter is not installed`);
  }
  const account = registry.getAccount(track.provider);
  if (account?.status !== 'authorized') {
    throw new MusicError('login_required',
      `${track.provider} is not signed in (${account?.status ?? 'unknown'}), so this track cannot be played`);
  }
  return registry.resolve(track, options);
}

/**
 * Merges each platform's seed import into one environment import.
 *
 * Sources stay per-platform: a QQ fallback to its liked list says nothing about
 * whether NetEase's recent list worked, so the two are never conflated.
 */
export function summarizeSeedRuns(runs) {
  const perPlatform = {};
  for (const run of runs) {
    perPlatform[run.provider] = run.ok
      ? { ok: true, source: run.source, imported: run.imported, requested: run.requested, degraded: Boolean(run.degraded), reason: run.reason ?? null }
      : { ok: false, source: null, imported: 0, requested: run.requested ?? 0, degraded: false, reason: `${run.code ?? 'error'}: ${run.message}` };
  }
  const succeeded = Object.entries(perPlatform).filter(([, value]) => value.ok).map(([name]) => name);
  const failed = Object.entries(perPlatform).filter(([, value]) => !value.ok).map(([name]) => name);
  return {
    perPlatform,
    succeeded,
    failed,
    totalImported: Object.values(perPlatform).reduce((sum, value) => sum + value.imported, 0),
    // One platform failing is a degraded result, not a total failure: the user
    // asked for both, and the plan says QQ support must not be withdrawn.
    partial: succeeded.length > 0 && failed.length > 0,
    reason: failed.length
      ? `${failed.join(', ')} could not be imported: ${failed.map((name) => perPlatform[name].reason).join('; ')}`
      : null,
  };
}