// Called only by the opt-in isolated DSH probe. No real account operation.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function verifyGuideInDsh({ evaluate, cdp, clickButton, until, rpc, restart, out, onProgress = () => {} }) {
  const result = { scope: 'real-dsh-web-source-client-default-core-empty-database', checks: [] };
  const check = (name, passed) => { result.checks.push({ name, passed }); onProgress(result); assert.ok(passed, name); };
  const bind = () => evaluate(`(()=>{for(const el of document.querySelectorAll('.fishfm,.fm-float')){const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let f=el[key],n=0;f&&n++<40;f=f.return){const c=f.memoizedProps?.controller;if(c?.openGuide&&c?.getSnapshot){window.__guideDshController=c;return true}}}return false})()`);
  const loaded = async () => { await until(bind); await until(() => evaluate(`__guideDshController.getSnapshot().connected&&__guideDshController.getSnapshot().profileState==='ready'&&__guideDshController.getSnapshot().libraryReady`)); };
  const enter = async () => {
    await until(() => evaluate(`!!document.body?.innerText.includes('肥鱼')`));
    await new Promise(r => setTimeout(r, 20000));
    if (await evaluate(`!![...document.querySelectorAll('h2')].find(e=>e.textContent.trim()==='开始使用'&&e.getClientRects().length)`)) {
      await clickButton('关闭');
      await until(() => evaluate(`![...document.querySelectorAll('h2')].some(e=>e.textContent.trim()==='开始使用'&&e.getClientRects().length)`));
    }
    if (!await evaluate(`!!document.querySelector('.fishfm')?.getClientRects().length`)) await clickButton('肥鱼电台', 'button,[role=button]');
    await loaded();
  };
  const shot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.data, 'base64')); };
  await enter(); await until(() => evaluate(`!!document.querySelector('.fm-guide')?.getClientRects().length`));
  check('fresh source install shows guide after real initial reads', await evaluate(`__guideDshController.getSnapshot().guideVisible`));
  await shot('guide-dsh');
  await evaluate(`(()=>{window.__guideDshWrites=[];const c=__guideDshController;for(const name of ['command','platformAction','personaAction']){const original=c[name];c[name]=function(...args){__guideDshWrites.push(name);return original.apply(this,args)}}return true})()`);
  await clickButton('去连接', '.fm-guide button');
  await until(() => evaluate(`document.activeElement?.hasAttribute('data-guide-login')`));
  check('connect opens platform and focuses real login without requesting a QR', await evaluate(`document.querySelector('.fm-platform-details').open&&!__guideDshController.getSnapshot().login`));
  await shot('guide-dsh-connect');
  await clickButton('打开使用指南', '.fishfm button'); await clickButton('去导入', '.fm-guide button');
  await until(() => evaluate(`document.activeElement?.hasAttribute('data-guide-login')`));
  check('unsigned import step reaches account controls with explanation', await evaluate(`document.querySelector('.fm-guide-target-note').textContent.includes('授权后')`));
  await clickButton('打开使用指南', '.fishfm button'); await clickButton('去播放页', '.fm-guide button');
  check('return to listening does not play or issue account/model actions', await evaluate(`document.querySelector('.fm-listen-page').hidden===false&&__guideDshController.getSnapshot().snapshot.paused&&__guideDshWrites.length===0`));
  const before = await rpc('fishfm-acceptance', { op: 'status' });
  check('no LLM stream calls', before.result.value.calls.length === 0);
  await clickButton('跳过引导', '.fm-guide button'); await cdp('Page.reload'); await enter();
  check('skip survives renderer reload', await evaluate(`!document.querySelector('.fm-guide')&&__guideDshController.getSnapshot().guideStatus==='skipped'`));
  await clickButton('电台设置', '.fishfm button'); await clickButton('打开使用指南', '.fishfm button');
  check('settings reopens guide', await evaluate(`!!document.querySelector('.fm-guide')?.getClientRects().length`));
  await clickButton('完成引导', '.fm-guide button');
  await restart(); await enter();
  check('completion survives real DSH and Core shutdown/restart at the retained origin', await evaluate(`!document.querySelector('.fm-guide')&&__guideDshController.getSnapshot().guideStatus==='completed'&&__guideDshController.getSnapshot().snapshot.paused`));
  const after = await rpc('fishfm-acceptance', { op: 'status' });
  check('no LLM stream calls after restart', after.result.value.calls.length === 0);
  result.guideRecord = await evaluate(`JSON.parse(localStorage.getItem('fishfm.guide.v1'))`);
  result.accountAuthorization = 'not_executed'; return result;
}
