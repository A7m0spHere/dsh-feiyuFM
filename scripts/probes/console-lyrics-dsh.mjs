// Opt-in probe for the installed production client and authenticated DSH routes.
// Uses an empty isolated profile; it does not log in or start audio/model work.
import assert from 'node:assert/strict';
export async function verifyConsoleLyricsInDsh({ evaluate, rpc, clickButton, until }) {
  const result = { scope: 'isolated-dsh-empty-profile-lyrics-and-seek-routes', checks: [], realSongPlayback: 'not_executed' };
  const check = (name, passed) => { result.checks.push({ name, passed }); assert.ok(passed, name); };
  await clickButton('正在听', '.fishfm button');
  await until(() => evaluate(`document.querySelector('.fm-lyrics')?.getClientRects().length > 0`));
  const ui = await evaluate(`(()=>{const el=document.querySelector('.fm-lyrics');return {empty:el.innerText.includes('播放歌曲后，歌词会显示在这里'),options:[...el.querySelectorAll('.fm-lyric-option')].map(b=>({pressed:b.getAttribute('aria-pressed'),disabled:b.disabled}))}})()`);
  check('installed client renders empty lyric area', ui.empty);
  check('translation and romanization default off', ui.options.length === 2 && ui.options.every(option => option.pressed === 'false'));
  check('missing auxiliary lyrics cannot be enabled', ui.options.every(option => option.disabled));
  const lyrics = await rpc('fishfm/lyrics', { track: { provider: 'netease', providerTrackId: '1' } });
  check('authenticated lyrics route reaches Core current-track validation', lyrics.http === 200 && lyrics.result.error?.code === 'stale_track');
  const seek = await rpc('fishfm/command', { type: 'seek', playInstanceId: 'missing', positionMs: 0 });
  check('authenticated seek route reaches Core instance validation', seek.http === 200 && seek.result.error?.code === 'stale_track');
  const invalid = await rpc('fishfm/command', { type: 'seek', playInstanceId: 'missing', positionMs: -1 });
  check('seek rejects invalid positions', invalid.result.error?.code === 'invalid_command');
  return result;
}
