// Participant-entered, local trial materials. Never infer votes from player events.
import {digest, fail, feedbackTemplate, keys, ratio, STAGES, text, validateFeedback, validateSnapshot} from './quality.mjs';

const alias = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(value);
const truth = value => value === true || value === false || value === null;
export const EXPERIENCE_FIELDS = ['reasonUnderstandable', 'tooConservative', 'tooUnexpected', 'wouldUseAgain', 'disturbing'];
export const ISSUE_CODES = ['install', 'import', 'playback', 'candidate-irrelevant', 'reason-unsupported', 'too-repetitive', 'control', 'other'];
export function participantTemplate(snapshot, {studyId = 'pilot-01', participantId} = {}) {
  validateSnapshot(snapshot);
  if (!alias(studyId) || !alias(participantId)) fail('study / participant 必须是 1–60 字符的匿名英文标识');
  const feedback = feedbackTemplate(snapshot); feedback.reviewer = participantId;
  return {version: 1, studyId, participantId,
    consent: {participate: false, localAnalysis: false, anonymousAggregate: false}, withdrawn: false, completed: false,
    observations: [], feedback, experiences: Object.fromEntries(EXPERIENCE_FIELDS.map(k => [k, null])), issues: []};
}

function observationMinutes(rows, now) {
  if (!Array.isArray(rows) || rows.length > 100) fail('observations 必须是最多 100 条的数组');
  const ranges = rows.map(row => {
    keys(row, ['startedAt', 'endedAt', 'activeMinutes'], 'observation');
    const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
    const start = timestamp(row.startedAt), end = timestamp(row.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now || end - start > 86400000
      || !Number.isFinite(row.activeMinutes) || row.activeMinutes < 0 || row.activeMinutes * 60000 > end - start) fail('观察时间无效、在未来或 activeMinutes 超出区间');
    return {start, end, minutes: row.activeMinutes};
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) fail('同一参与者的观察区间重叠，不能重复累计');
  return ranges.reduce((sum, row) => sum + row.minutes, 0);
}
export function validateParticipant(p, s, now = Date.now()) {
  validateSnapshot(s);
  keys(p, ['version', 'studyId', 'participantId', 'consent', 'withdrawn', 'completed', 'observations', 'feedback', 'experiences', 'issues'], 'participant');
  if (p.version !== 1 || !alias(p.studyId) || !alias(p.participantId) || typeof p.withdrawn !== 'boolean' || typeof p.completed !== 'boolean') fail('participant 版本或标识无效');
  keys(p.consent, ['participate', 'localAnalysis', 'anonymousAggregate'], 'consent');
  if (Object.values(p.consent).some(value => typeof value !== 'boolean') || Object.keys(p.consent).length !== 3) fail('consent 必须分别明确 true / false');
  // Withdrawn or nonconsenting packets do not feed analysis, even if old votes remain.
  if (p.withdrawn || !p.consent.participate || !p.consent.localAnalysis || !p.consent.anonymousAggregate) return {excluded: p.withdrawn ? 'withdrawn' : 'no-consent', minutes: 0};
  validateFeedback(p.feedback, s);
  if (p.feedback.reviewer !== p.participantId) fail('feedback 评价者与 participant 不匹配');
  keys(p.experiences, EXPERIENCE_FIELDS, 'experiences');
  if (EXPERIENCE_FIELDS.some(k => !truth(p.experiences[k]))) fail('体验问题只能填 true / false / null');
  if (!Array.isArray(p.issues) || p.issues.length > 100) fail('issues 数量越界');
  for (const issue of p.issues) {
    keys(issue, ['stage', 'code', 'blocking', 'note'], 'issue');
    if (!STAGES.includes(issue.stage) || !ISSUE_CODES.includes(issue.code) || typeof issue.blocking !== 'boolean' || !text(issue.note, 500)) fail('issue 分类或备注无效');
  }
  const minutes = observationMinutes(p.observations, now);
  const judged = p.feedback.ratings.filter(r => r.rating !== 'unknown').length;
  if (!p.feedback.confirmedHuman && (minutes > 0 || p.issues.length || Object.values(p.experiences).some(v => v !== null))) fail('真人试用记录需由填写者确认 confirmedHuman');
  if (p.completed && (minutes <= 0 || !p.feedback.confirmedHuman || !judged)) fail('标记 completed 需要真实观察和至少一条明确歌曲评价');
  if (s.kind === 'synthetic') return {excluded: 'synthetic', minutes: 0};
  if (!p.feedback.confirmedHuman || minutes <= 0) return {excluded: 'not-started', minutes: 0};
  return {excluded: null, minutes};
}

export function summarizeTrial(packets, {now = Date.now()} = {}) {
  if (!Array.isArray(packets) || !packets.length || packets.length > 20) fail('每次汇总需 1–20 份参与者材料');
  const seen = new Set(), hashes = [], exclusions = {}, eligible = [], issues = new Map();
  let studyId = null;
  for (const {participant: p, snapshot: s} of packets) {
    const result = validateParticipant(p, s, now);
    if (seen.has(p.participantId)) fail('同一参与者有重复材料，不能重复计算人数');
    seen.add(p.participantId);
    if (studyId && studyId !== p.studyId) fail('不同 study 的材料不能混合');
    studyId = p.studyId;
    hashes.push(digest({participant: p, snapshot: s}));
    if (result.excluded) { exclusions[result.excluded] = (exclusions[result.excluded] ?? 0) + 1; continue; }
    eligible.push({...result, p, s});
    for (const issue of p.issues) {
      const group = issues.get(issue.stage) ?? {stage: issue.stage, reports: 0, blocking: 0, codes: {}};
      group.reports++; group.blocking += Number(issue.blocking); group.codes[issue.code] = (group.codes[issue.code] ?? 0) + 1;
      issues.set(issue.stage, group);
    }
  }
  const votes = eligible.flatMap(({p}) => p.feedback.ratings), judged = votes.filter(r => r.rating !== 'unknown');
  const newJudged = judged.filter(r => r.heardBefore !== null && r.playback === 'played');
  const discoveries = newJudged.filter(r => r.heardBefore === false && r.rating === 'worth');
  const experiences = Object.fromEntries(EXPERIENCE_FIELDS.map(k => [k, {
    yes: eligible.filter(({p}) => p.experiences[k] === true).length,
    no: eligible.filter(({p}) => p.experiences[k] === false).length,
    unknown: eligible.filter(({p}) => p.experiences[k] === null).length}]));
  const rankedIssues = [...issues.values()].sort((a, b) => b.reports - a.reports || a.stage.localeCompare(b.stage));
  const reasons = votes.filter(r => r.reasonSupported !== null);
  return {version: 1, inputHash: digest(hashes.sort()), packetCount: packets.length, excludedPackets: exclusions,
    participantsWithObservation: eligible.length, completedParticipants: eligible.filter(({p}) => p.completed).length,
    activeObservationMinutes: eligible.reduce((sum, row) => sum + row.minutes, 0), durationSource: 'participant-reported; not independently measured',
    judgedSongs: judged.length, worthRate: ratio(judged.filter(r => r.rating === 'worth').length, judged.length),
    newDiscoveryCount: discoveries.length, newDiscoveryDenominator: newJudged.length, newDiscoveryRate: ratio(discoveries.length, newJudged.length),
    reasonSupportRate: ratio(reasons.filter(r => r.reasonSupported).length, reasons.length),
    blockingIssueReports: rankedIssues.reduce((sum, row) => sum + row.blocking, 0), topIssues: rankedIssues.slice(0, 3),
    issueCategoryCount: rankedIssues.length, unknownAttributionReports: issues.get('unknown')?.reports ?? 0, experiences,
    status: eligible.length && judged.length ? 'review_required_small_sample' : 'awaiting_real_trial',
    decisions: {preferenceChange: 'not_established', explorationChange: 'not_established', activeSharing: 'not_authorized'},
    newModelCalls: 0, limitations: ['人工自报时长，不是播放器有效收听或生产稳定性证明', '每人一个固定批次；新批次需重新导出并保留来源',
      '匿名化账号别名只在单份快照内有效，不用于跨用户匹配', '小样本不支持总体质量或因果归因；不足三类问题时不补造']};
}

export function trialMarkdown(r) {
  return `# 真实试用汇总\n\n状态：${r.status}。材料 ${r.packetCount} 份；排除：\`${JSON.stringify(r.excludedPackets)}\`。\n\n真实观察参与者 ${r.participantsWithObservation} 人、完成 ${r.completedParticipants} 人、人工自报有效观察 ${r.activeObservationMinutes} 分钟；明确评价 ${r.judgedSongs} 条。\n\n此前未听过、实际播放且愿再听 ${r.newDiscoveryCount} 条；分母 ${r.newDiscoveryDenominator}，比例 ${r.newDiscoveryRate === null ? '未知' : r.newDiscoveryRate}。没有反馈不能当不喜欢。\n\n## 最多三类主要问题\n\n${r.topIssues.length ? '| 人工归因 | 记录数 | 阻断数 |\n|---|---|---|\n' + r.topIssues.map(i => `| ${i.stage} | ${i.reports} | ${i.blocking} |`).join('\n') : '尚无可归因的真实记录，不生成三类问题。'}\n\n备注、身份、歌名、账号和单曲记录不进入此汇总。具体计数与体验回答见 report.json。\n\n${r.limitations.map(s => `- ${s}`).join('\n')}\n\n缺少真实证据时保留现有策略；#9/#10 的收益尚未建立，主动分享未获授权。\n`;
}

export function trialFiles(snapshot, options) {
  const participant = participantTemplate(snapshot, options);
  const labels = snapshot.candidates.map(c => `${c.id}：${c.title} / ${c.artist || '艺人未知'}`).join('\n');
  return {'snapshot.json': snapshot, 'participant.json': participant,
    'task-card.md': `# FishFM 试用任务卡\n\n匿名标识：${participant.participantId}；研究：${participant.studyId}。\n\n${snapshot.kind === 'synthetic' ? '**这是合成演示材料，不能计入真实参与者或质量结论。**' : '这是本机固定历史批次，不重新调用模型。'}\n\n1. 先阅读 data-boundaries.md；自愿参加时自行填写 participant.json 中三个 consent 项。可随时 withdrawn=true 退出。\n2. 在平常的 DSH 中安装/打开 FishFM，按已有方式导入参考歌曲。记录卡住或失败的步骤；不为研究增加模型预算。\n3. 在自己方便时体验播放、暂停、下一首、关闭面板和重新打开。暂停/跳过/静音不等同不喜欢。\n4. 自选少量推荐，填写 feedback.ratings 的四档评价、是否以前听过、是否实际播放、推荐依据是否可信。填写者确认后置 feedback.confirmedHuman=true。\n5. 按多次真实使用分别记录 observations（带时区的开始/结束时间与实际参与分钟），不把整段空闲时间计入。可按自身安排体验 1–2 周，不要求每天使用、不要求两小时长跑。\n6. 填 experiences 的五个问题；issues 每条写 stage/code/blocking/note。归因不确定填 unknown，不凑三类。全部动作做过且有真实观察/评价后再置 completed=true。\n\n原始任务：安装→导入→播放控制→找歌→评价→再次使用。发生阻断时保留 completed=false，仍可记录实际参与时长和问题。\n\n## 当前批次本机对照\n\n${labels}\n\n别名模式下无法识别歌曲时，自己用 --metadata 重新导出目录元数据，再生成新试用包；不要给别人的曲库代填反馈。输入 hash：${digest(snapshot)}。\n\n字段说明和命令见仓库 docs/research/TRIAL.md。\n`,
    'data-boundaries.md': `# 自愿参与与数据边界\n\n材料只保存在本机，不会自动收集、上传、发消息或调用模型。匿名别名不要求姓名、邮箱或登录信息。\n\n请分别确认：participate（愿意试用）、localAnalysis（允许本机分析这份主动填写的记录）、anonymousAggregate（允许将人数、时间、评价和问题类别用于匿名汇总）。默认为 false；拒绝任一项或 withdrawn=true 的材料不纳入本汇总。允许本机汇总不等于授权对外发布，实际分享仍需参与者选择。\n\n不填写 Cookie、凭据、媒体 URL、私人对话或完整歌单。--metadata 模式仅用于自己识别歌曲，原始材料仍留本机忽略目录；汇总不包含姓名、别名、歌名、账号、具体观察时间或私人备注。\n\n参与者可随时停止、撤回或删除自己的材料，再次汇总将排除该人；已手动分享的历史副本需联系副本持有人处理。重新运行报告请使用新输出目录，并删除不再需要的旧汇总。\n`};
}
