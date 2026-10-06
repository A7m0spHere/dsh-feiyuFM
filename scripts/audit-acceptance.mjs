#!/usr/bin/env node
// Acceptance audit: does every claim have evidence that still exists?
//
// The acceptance table claims a status per item, and those claims are only worth
// anything if the evidence behind them is real. Tests get renamed and deleted;
// evidence files get moved. This script holds the mapping from each acceptance
// item to its evidence and checks that every referenced file and named test is
// actually present, so a claim cannot quietly outlive its proof.
//
//   node scripts/audit-acceptance.mjs [--json]
//
// It checks presence and naming, not correctness: a passing test name is not a
// guarantee the behaviour is right, which is why each row also records what is
// still unverified in the plan.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const asJson = process.argv.includes('--json');

/**
 * What each acceptance item rests on. `status` mirrors the completion table in
 * docs/PROJECT_PLAN.md, and `unverified` is the honest remainder.
 */
const EVIDENCE = [
  {
    id: 'A01', claim: '两个平台各自完成登录、搜索、真实播放、暂停、恢复、下一首',
    status: 'not-passed',
    files: [
      'docs/spikes/P2-netease.md', 'docs/spikes/P4-P5-platforms.md',
      'test/providers.test.mjs', 'test/providers-qq.test.mjs', 'test/login-flow.test.mjs',
      'test/playback.test.mjs',
      'test/netease-qr.test.mjs', 'docs/spikes/U6-qr-login-repair.md', 'docs/spikes/P3-real-loop.md',
    ],
    tests: [
      { file: 'test/providers.test.mjs', name: 'the NetEase adapter passes the shared provider contract' },
      { file: 'test/providers-qq.test.mjs', name: 'the QQ adapter passes the same shared contract checks as NetEase' },
    ],
    unverified: '网易云 P3 通过；QQ 按用户要求暂缓，双平台 A01 未通过',
  },
  {
    id: 'A02', claim: '可导入目标数量；数量不足、收藏/歌单降级和空结果均如实展示',
    status: 'offline-passed',
    files: ['docs/spikes/T1-environment.md', 'docs/spikes/P3-real-loop.md', 'docs/spikes/N4-environment-profile.md', 'test/taste.test.mjs', 'test/core-host.test.mjs'],
    tests: [
      { file: 'test/taste.test.mjs', name: 'an import records its real source, the requested and the imported counts' },
    ],
    unverified: '网易云近期/喜欢/指定歌单响应与 UI 更新已验；自动降级的完整失败/空结果轨迹及 QQ 未验',
  },
  {
    id: 'A03', claim: '两个开关四种组合、四个模式、暂停保持和到期约束符合第 3 节',
    status: 'offline-passed',
    files: ['test/core.test.mjs', 'test/ui-panel.test.mjs', 'docs/spikes/U2-panel.md'],
    tests: [
      { file: 'test/core.test.mjs', name: 'mode and switch combinations preserve explicit mute and pause' },
      { file: 'test/ui-panel.test.mjs', name: 'the four switch combinations are all named, and the mode is derived, not stored twice' },
    ],
    unverified: '真实暂停/恢复/换曲已验；四开关组合、全部模式和到期约束完整真机覆盖仍未完成',
  },
  {
    id: 'A04', claim: '用户点歌/下一首优先；禁播、暂停不会被自动事件覆盖',
    status: 'offline-passed',
    files: ['test/core.test.mjs', 'test/selection.test.mjs', 'docs/spikes/T2-selection.md'],
    tests: [
      { file: 'test/core.test.mjs', name: 'late resolve cannot replace a newer user track or undo pause' },
    ],
    unverified: '真实慢请求与真实命令冲突未验',
  },
  {
    id: 'A05', claim: '熟悉池、探索率 0/20/100%、候选为空和重复惩罚有效',
    status: 'offline-passed',
    files: ['test/selection.test.mjs', 'docs/spikes/T2-selection.md', 'test/discovery-cache.test.mjs', 'test/discovery-provider.test.mjs', 'docs/spikes/N2-netease-discovery.md', 'docs/spikes/N3-discovery-cache.md'],
    tests: [
      { file: 'test/selection.test.mjs', name: 'discovery rate 0 always stays familiar; 100 always tries discovery' }
      , { file: 'test/selection.test.mjs', name: 'an empty discovery pool falls back to familiar and records that no exploration happened' }
      , { file: 'test/selection.test.mjs', name: 'repeat penalty grows with the number of recent plays' },
    ],
    unverified: '真实网易云发现池与自主推荐播放已接通；完整长期比例与双平台仍待后续验收',
  },
  {
    id: 'A06', claim: '用户环境与 Agent 偏好分离，重启后保留；Session 不覆盖长期偏好',
    status: 'offline-passed',
    files: ['test/taste.test.mjs', 'test/sessions.test.mjs', 'test/migration.test.mjs', 'docs/spikes/T1-environment.md'],
    tests: [
      { file: 'test/sessions.test.mjs', name: 'a transient session precipitates less, and its influence is capped' }
      , { file: 'test/taste.test.mjs', name: 'a restart keeps the same personality instead of reshuffling it' },
    ],
    unverified: '真实导入/重启与 N1 五条成长对照已验；完整多会话与长期差异未验',
  },
  {
    id: 'A07', claim: 'DSH 内嵌音乐设置与 shell.overlay 悬浮条共用 Core；显示状态同步，隐藏/页面切换不停止播放',
    status: 'partial',
    files: ['test/ui-bridge.test.mjs', 'test/ui-ipc.test.mjs', 'test/ui-panel.test.mjs', 'test/dsh-client.test.mjs', 'test/dsh-settings.test.mjs', 'test/client-assets.test.mjs', 'docs/spikes/U3-dsh-settings.md', 'docs/spikes/U4-quick-login.md', 'docs/spikes/U5-official-desktop.md', 'docs/spikes/U7-phl-ui-motion.md', 'test/ui-presentation.test.mjs'],
    tests: [
      { file: 'test/dsh-client.test.mjs', name: 'client contributes native sidebar, main and settings seats; controls send Core commands' },
      { file: 'test/dsh-client.test.mjs', name: 'floating music control shares Core actions and its menu opens the full settings panel' },
      { file: 'test/dsh-client.test.mjs', name: 'an expired import refreshes the account card and exposes the re-login state' },
      { file: 'test/dsh-client.test.mjs', name: 'floating visibility and the docked edge survive a renderer remount' },
      { file: 'test/dsh-client.test.mjs', name: 'dragging docks the floating bar to an edge and arrow keys move it accessibly' },
      { file: 'test/dsh-settings.test.mjs', name: 'settings RPC persists changes through Core restart and preserves pause' },
    ],
    unverified: 'U7 深色/窄窗口/键盘/动效浏览器验证与真实 DSH 搜索已验；完整真实宿主键盘与长期播放覆盖仍待验',
  },
  {
    id: 'A08', claim: '多 Session 不抢占播放；插件退出停止音乐，DSH 正常工作',
    status: 'partial',
    files: ['test/sessions.test.mjs', 'test/dsh-adapter.test.mjs', 'test/plugin-bundle.test.mjs', 'docs/spikes/A08-sessions.md'],
    tests: [
      { file: 'test/sessions.test.mjs', name: 'two concurrent sessions do not let the inactive one start music' },
      { file: 'test/dsh-adapter.test.mjs', name: 'stopping the bridge stops the core process, which is what unload does' },
    ],
    unverified: '真实并发的 DSH 会话未验；真实会话标识字段名未确认',
  },
  {
    id: 'A09', claim: '连续两小时自动听歌；逐曲零模型请求，计划内低频调用受开关、冷却、预算约束并入账',
    status: 'not-passed',
    files: ['src/runtime/recorder.mjs', 'scripts/soak.mjs', 'test/recorder.test.mjs', 'docs/spikes/R2-soak.md', 'src/runtime/evidence.mjs', 'scripts/observe-runtime.mjs', 'docs/spikes/N0-runtime-evidence.md'],
    tests: [
      { file: 'test/recorder.test.mjs', name: 'the recorder counts requests by kind and proves a zero model count' },
      { file: 'test/dsh-adapter.test.mjs', name: 'translates only the allowlisted session events' },
    ],
    unverified: '两小时真实运行与 DSH 侧请求对照未做',
  },
  {
    id: 'A10', claim: '静音、暂停、播放失败、进程重启不会伪增听歌次数或偏好',
    status: 'offline-passed',
    files: ['test/faults.test.mjs', 'test/growth.test.mjs', 'test/core.test.mjs', 'docs/spikes/R1-faults.md', 'test/autonomous-accounting.test.mjs', 'docs/spikes/N1-autonomous-accounting.md'],
    tests: [
      { file: 'test/faults.test.mjs', name: 'a login that expired mid-session stops music honestly instead of pretending' },
      { file: 'test/growth.test.mjs', name: 'a pause, a failure, a short listen and a user pick change nothing' },
    ],
    unverified: '真实进程重启的长时间行为未验',
  },
];

/** Discover all docs so new design/evidence pages cannot escape link checking. */
function documentationFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? documentationFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}
const DOC_LINKS_FROM = ['README.md', 'CONTRIBUTING.md', ...documentationFiles('docs')];

const testNames = new Map();
for (const file of readdirSync(join(root, 'test'))) {
  if (!file.endsWith('.test.mjs')) continue;
  const relative = `test/${file}`;
  const body = readFileSync(join(root, relative), 'utf8');
  const names = new Set();
  // Matches both test('name', …) and test("name", …).
  for (const match of body.matchAll(/^test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)) {
    names.add(match[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  testNames.set(relative, names);
}

const problems = [];
const rows = [];

for (const item of EVIDENCE) {
  const missingFiles = item.files.filter((file) => !existsSync(join(root, file)));
  const missingTests = [];
  for (const reference of item.tests) {
    const names = testNames.get(reference.file);
    if (!names) {
      missingTests.push(`${reference.file} (no such test file)`);
      continue;
    }
    // Allow a prefix match so a test can gain detail in its title without the
    // audit failing for a wording change.
    const found = [...names].some((name) => name === reference.name || name.startsWith(reference.name));
    if (!found) missingTests.push(`${reference.file} :: ${reference.name}`);
  }

  const ok = missingFiles.length === 0 && missingTests.length === 0;
  rows.push({ id: item.id, status: item.status, ok, missingFiles, missingTests, unverified: item.unverified });
  if (!ok) {
    problems.push({ id: item.id, missingFiles, missingTests });
  }
}

// Every acceptance item in the product spec must appear in this audit, or the
// audit itself becomes the weak link.
const spec = readFileSync(join(root, 'docs', 'MVP.md'), 'utf8');
const declared = [...spec.matchAll(/^\| (A\d{2}) \|/gm)].map((match) => match[1]);
const audited = EVIDENCE.map((item) => item.id);
const undocumented = declared.filter((id) => !audited.includes(id));
const invented = audited.filter((id) => !declared.includes(id));

// Doc links must resolve, so the evidence is reachable from the docs.
const brokenLinks = [];
for (const document of DOC_LINKS_FROM) {
  const path = join(root, document);
  if (!existsSync(path)) { brokenLinks.push(`${document} (missing document)`); continue; }
  const body = readFileSync(path, 'utf8');
  const base = document.includes('/') ? document.slice(0, document.lastIndexOf('/')) : '';
  for (const match of body.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // external or a custom scheme such as chatgpt-conversation://
    const resolved = resolve(root, base, target);
    if (!existsSync(resolved)) brokenLinks.push(`${document} -> ${target}`);
  }
}

if (asJson) {
  console.log(JSON.stringify({ rows, problems, undocumented, invented, brokenLinks, documentsChecked: DOC_LINKS_FROM.length }, null, 2));
} else {
  console.log('Acceptance audit — does every claim still have its evidence?');
  console.log('');
  for (const row of rows) {
    const label = { 'offline-passed': '离线通过', 'partial': '部分通过', 'not-passed': '未通过' }[row.status] ?? row.status;
    console.log(`${row.ok ? 'OK  ' : 'MISS'}  ${row.id}  ${label.padEnd(6)}  ${row.ok ? `${row.missingFiles.length + row.missingTests.length} problems` : ''}`);
    if (!row.ok) {
      for (const file of row.missingFiles) console.log(`        missing file: ${file}`);
      for (const test of row.missingTests) console.log(`        missing test: ${test}`);
    }
    console.log(`        still unverified: ${row.unverified}`);
  }
  console.log('');
  console.log(`acceptance items in the spec: ${declared.length}; audited: ${audited.length}`);
  if (undocumented.length) console.log(`  NOT audited: ${undocumented.join(', ')}`);
  if (invented.length) console.log(`  audited but not in the spec: ${invented.join(', ')}`);
  console.log(`documents checked: ${DOC_LINKS_FROM.length}; broken document links: ${brokenLinks.length}`);
  for (const link of brokenLinks) console.log(`  ${link}`);
  console.log('');
  const passed = rows.filter((row) => row.ok).length;
  console.log(`RESULT: ${passed}/${rows.length} acceptance items have all their evidence present`);
}

process.exit(problems.length === 0 && undocumented.length === 0 && invented.length === 0 && brokenLinks.length === 0 ? 0 : 1);
