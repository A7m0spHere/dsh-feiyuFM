# #11 真实试用操作卡

这份材料可直接交给自愿参与者。建议 3–5 人、各自方便时体验约 1–2 周；可先从一人开始，不要求每天使用，不要求两小时连续观察。人数和时长不是预设的已完成事实。#6 审计已完成；真实音频、DSH 并发等现有未验项仍看 [PROJECT_PLAN](../PROJECT_PLAN.md)。

本轮用户已选择“先完成工具和材料，真实试用稍后进行”。未填写的材料不算真人反馈。

## 准备每人的本机试用包

先按 [#7 说明](README.md) 从该参与者自己的合法数据只读导出一批推荐。需要识别歌名时使用 `--metadata`，不要把别人的曲库、账户或模型批次复制给参与者。

```powershell
npm run research -- export --database C:/Users/你的用户名/.dsh/fishfm/music.sqlite --out .tmp/p01-source --metadata
npm run research -- trial-init --input .tmp/p01-source/snapshot.json --participant p01 --study pilot-01 --out .tmp/study/p01
```

生成四个文件：

| 文件 | 用法 |
|---|---|
| `task-card.md` | 顺序任务、候选对照和固定输入 hash |
| `data-boundaries.md` | 自愿参与、三项分别确认、撤回及本地/对外分享边界 |
| `participant.json` | 实际填写的时间、反馈、体验问题和是否完成 |
| `snapshot.json` | 该参与者的固定批次，不编辑或替换 |

没有真实快照时可先用 `scripts/fixtures/research/snapshot.json` 演练生成流程；工具始终把该样本当合成材料，即使填写测试评价也不会计入真实试用。

每人只保留一份同一 `study` 的包。第一轮固定抽查一个批次的少量推荐，用多次观察和体验问题补充；不是收集所有新歌的遥测。若要测试新批次，生成新研究的独立包，不替换旧快照或混用旧评价。此限制会进入报告，不据固定样本推断全部推荐质量。

## 参与者执行顺序

1. 阅读数据边界，自行确认愿意试用、允许本机分析、允许匿名汇总。默认三项均为 `false`。不愿参与可停止，或置 `withdrawn=true`；不要求提供姓名、邮箱或凭据。
2. 尝试安装/打开、导入自己的参考歌曲。失败就记录在哪一步卡住，不要求反复重试或增加模型预算。
3. 在普通使用中尝试播放、暂停、下一首、关闭面板后继续播放及再次打开。只观察既有控制是否符合预期，不为研究发新消息或开启额外自动任务。
4. 从任务卡选少量歌曲，自己判断“愿再听／可以试但一般／不喜欢／无法判断”，并记录是否以前听过、是否实际播放及理由是否可信。不把静音、暂停、跳过或权限失败自动视为不喜欢。
5. 每次实际参与后填写一个 `observations` 区间，记录主动体验的分钟数。过几天再次使用时追加新区间；不要把安装到今天的全部日历时长当有效观察。
6. 填写五个体验问题和具体故障；自己核对后置 `feedback.confirmedHuman=true`。完成整张任务卡、有正数观察时间且至少一条明确歌曲评价时再置 `completed=true`。安装受阻等情况保持 `false`，保留实际时间和阻断问题。

## 填写字段

`participant.json` 使用 JSON，空白状态已生成。只修改评价和记录字段，保留 `studyId/participantId/inputHash/candidateId`。JSON 不支持注释，编辑时不要在数字后加单位。

| 字段 | 填写规则 |
|---|---|
| `consent.participate` | 自愿参与为 `true` |
| `consent.localAnalysis` | 允许本机分析主动填写的材料为 `true` |
| `consent.anonymousAggregate` | 允许本机生成匿名汇总为 `true`；这不自动授权公开发布 |
| `withdrawn` | 撤回后为 `true`，后续汇总排除；可删除自己的原材料 |
| `feedback.ratings[].rating` | `worth` 愿再听；`try` 一般但可尝试；`not-worth` 明确不喜欢；`unknown` 无法判断 |
| `heardBefore` | `true` 以前听过；`false` 明确未听过；`null` 不确定 |
| `reasonSupported` | `true/false/null`，依据是否可信；不要求替模型猜流派、情绪或听感 |
| `playback` | `played/unavailable/unknown`；未实际播放不要填 played |
| `feedback.confirmedHuman` | 由实际填写者确认，工具或 Agent 不替真人评价 |

五个 `experiences` 问题均填 `true/false/null`：

| 字段 | 问题 |
|---|---|
| `reasonUnderstandable` | 能理解推荐原因吗？ |
| `tooConservative` | 推荐是否过于保守、像在重复旧歌？ |
| `tooUnexpected` | 推荐是否偏离喜好太远？ |
| `wouldUseAgain` | 下次愿意再让 FishFM 选歌吗？ |
| `disturbing` | 使用时是否受到不必要的打扰？ |

下面只是字段示例，不是已发生的记录；用自己的真实时间替换后才添加到 `observations`：

```json
{"startedAt":"2026-10-18T19:00:00+08:00","endedAt":"2026-10-18T19:30:00+08:00","activeMinutes":10}
```

`activeMinutes` 是这段时间里主动体验的分钟，可为小数；不能超过开始到结束的区间。同一人区间不能重叠，结束不能在未来。报告明确标注“参与者自报”，不把它当播放器有效收听时长或稳定性测试。

`issues` 每条格式如下。只写实际遇到的问题，无法归因时选 `unknown`：

```json
{"stage":"unknown","code":"other","blocking":false,"note":"只写自己的具体步骤和现象，不含登录信息"}
```

`stage` 可选 `platform/filter/preference/playback/interaction/unknown`，分别表示平台候选、模型筛选、反馈理解、播放权限或音频、交互、不确定。它是参与者初步归因，不是已诊断的代码根因。`code` 可选 `install/import/playback/candidate-irrelevant/reason-unsupported/too-repetitive/control/other`。`blocking` 表示是否阻断继续使用。`note` 最多 500 字，只留本机，不进汇总。

## 本机汇总

参与者各自填写后，只有在他们选择共享本机分析材料时才收集到研究目录。不要自动联络、发送材料或上传数据。目录形式为 `.tmp/study/p01`、`.tmp/study/p02` 等，分别保存各人的两个 JSON；不要把报告目录放在这个输入目录里面。

```powershell
npm run research -- trial-report --input .tmp/study --out .tmp/trial-summary
```

也可以把 `--input` 指向单人的包。汇总最多读 20 个直接子目录，不递归扫描；同一参与者重复、不同 study 混合、批次不符和非法观察时间会失败。不确认、撤回和合成材料被排除。已存在输出目录不会覆盖，修订后用新目录再汇总。

`report.json/report.md` 仅包含人数、参与者自报时间、评价计数、五个体验问题、至多三类主要问题及限制；不含参与者别名、歌曲、账号、具体时间或私人备注。问题按人工归因的记录条数排序，不是受影响人数或严重性排名。不足三类时保留实际数量，不凑数。

“此前未听过且愿再听”要求同一条记录 `heardBefore=false`、`rating=worth` 且 `playback=played`；分母是同时提供明确评价、是否听过并实际播放的记录数。无观察或无有效反馈时输出人数/时间 0、质量比例 `null` 和 `awaiting_real_trial`，不能宣称质量差或试用成功。

完成的真人试用也只给 `review_required_small_sample`：研究者仍需阅读失败、样本差异和反馈，判断问题来自平台、筛选、反馈理解还是交互。不能仅凭这个状态开启 #9/#10 改造或 #4 主动分享。少量个案不支持总体推断或因果结论。

退出研究后删除对应包并重新汇总；先前手动分享的副本需另行处理。原始材料默认只留忽略的 `.tmp/`，公开分享仅使用参与者选择允许的匿名汇总。
