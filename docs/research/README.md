# 推荐质量研究与真实试用

关联 [#7 推荐质量基线](https://github.com/A7m0spHere/dsh-feiyuFM/issues/7) 和 [#11 真实试用](https://github.com/A7m0spHere/dsh-feiyuFM/issues/11)。状态只在 [PROJECT_PLAN](../PROJECT_PLAN.md) 维护。本目录是操作方法，不表示已有真人评价。

## #7：固定输入的离线比较

从仓库根目录运行，Node 24.14+，无需新增依赖、账号、API key 或模型配置。

```powershell
npm run research -- replay --input scripts/fixtures/research/snapshot.json --out .tmp/research-demo --top-k 3
```

输出 `snapshot.json`、`report.json`、`report.md`、`feedback.template.json`。样本明确为 `synthetic`；输入 SHA-256 相同且参数相同时，报告一致。已有输出目录会被拒绝，重新运行请换目录。

真实使用结束后，可从自己有权访问的数据库导出一批历史结果：

```powershell
npm run research -- export --database C:/Users/你的用户名/.dsh/fishfm/music.sqlite --out .tmp/research-local
```

数据库通过 `DatabaseSync({readOnly:true})` 在同一读事务中查询，不实例化会迁移数据的 `MusicStore`，不启动 Core、播放或模型。只读出已保存筛选的调用账本、同批候选、最多四首参考曲，以及完成时间之前的有界历史投影；不导出凭据、Cookie、媒体 URL、完整曲库、Session 或私人对话。候选/账号/批次标识转换为本快照别名。跨批次、账本与筛选归属不一致时拒绝导出。

默认歌名、艺人及原始理由也用别名或占位文字。需要真人对照歌曲时显式加 `--metadata`，仅在本机保留本批候选和参考曲的目录元数据；该文件仍可能透露个人喜好，留在忽略的 `.tmp/` 下，不提交或上传。公开结果只用不含歌曲名和评价者身份的汇总。

历史导出从保存的 `picks` 重建模型 JSON，不是原始模型文本重放，也不重新推理。时间固定在原调用完成时；原始候选有效期参与排除。导出只使用原调用的 `facts_json/localCandidates`，不拼接当前账号的新缓存。历史最多取完成前 100 条有效记录用于“已知”判断、30 分钟内最多 50 条记录用于重复率；未发现记录不能证明从未听过，保留 `null`。当时没有保存的禁播、播放权限、完整长期偏好、随机状态及设置不补造，不能据此声称重现 Core 完整选择过程。

## 比较边界和指标

基线是生产 `finishSummary` 解析后的已保存 LLM 排名，研究变体 `distinct-artist-first` 只把同一入选集合中不同艺人的歌曲优先排列。两者比较前 `top-k` 首（1–12，默认 6）；变体不新增候选、不改变理由、不进入产品。未知艺人不当成独立艺人。禁播、已知不可播、过期和显式关闭探索时的非已知歌曲在两边共同排除。

这不是 Core 自动播放顺序的回放：Core 还会应用本地评分、冷却、用户命令和随机选择。本工具回答“已保存推荐名单前部的结构有什么变化”，不能把多样性上升直接叫作推荐更好。

| 指标 | 分母和来源 | 未知情况 |
|---|---|---|
| `artistDiversity` | 前 k 首有艺人名的曲目中，不同艺人数 / 曲目数；字符串身份 | 无艺人名时 `null`，同时列 `artistCoverage`；不声称平台艺人 ID 等价 |
| `repeatRate` | 前 k 首在快照 `recentIds` 中的数量 / 前 k 首数量 | 无入选项时 `null`；历史范围有限 |
| `unfamiliarRate` | 已知熟悉状态曲目中 `known=false` 的比例 | 缺失历史不自动变为陌生；列 `knownStatusCount` |
| `unavailableRate` | 已知播放权限曲目中不可播的比例 | 没有权限实测时 `null`，空值不记失败 |
| `worthRate` | 真人标“值得推荐”的数量 / 非 unknown 的人工评价数 | 没有人工评价时 `null`，同时列 `humanJudged/humanCoverage` |
| `newDiscoveryRate` | 真人同时标“此前未听过且愿再听”的数量 / 同时提供评价和是否听过的曲目数 | 没有双项评价时 `null`；不等同陌生曲比例 |
| `reasonSupportRate` | 真人确认依据可信的数量 / 对理由作出判断的数量 | 缺失不自动通过；流派/情绪无证据时未知 |
| 调用与成本 | 同一 `fact_hash`、截至原结果完成时的至多 100 条筛选账本；分列失败和未知用量 | 预留与实际字段分开；不推算价格、不重复计算变体成本 |

`cacheReadTokens/cacheWriteTokens/reasoningTokens` 按原用量字段分别报告，不与 input/output 相加宣称“总 token”，避免 Provider 的重叠口径。回放新增调用和 tokens 为 0。

## 人工评价

复制 `feedback.template.json` 为自己的反馈文件，修改 `reviewer` 为匿名别名；完成后由填写者置 `confirmedHuman=true`。`rating` 取 `worth/try/not-worth/unknown`，对应愿再听／可尝试但一般／不喜欢／无法判断。`heardBefore` 和 `reasonSupported` 分别取 `true/false/null`；`playback` 取 `played/unavailable/unknown`。不要把跳过、静音、暂停或失败自动填写为不喜欢。`inputHash` 和候选 ID 保持原样。

```powershell
npm run research -- replay --input .tmp/research-local/snapshot.json --feedback .tmp/research-local/my-feedback.json --out .tmp/research-reviewed
```

输入或元数据模式变化，hash 也变化，旧反馈不能混入。合成样本即使填测试评价仍标 `synthetic_only`；真实快照无人评价为 `awaiting_human_feedback`，收到评价只变为 `review_required`。工具不会自动得出策略应上线的结论。

## 决策规则

先比较失败、人工命中、新发现、多样性、重复与成本，再决定 #9/#10 是否值得修改。缺少人工反馈、样本少或变体无收益时保留当前策略。有可复现收益才开小改动；不在本工具中上线通知或主动分享。主动分享候选至少应有真人“愿再听”、此前未听过、来源/理由可核验且没有已知不可播；这只是未来 #4 的研究建议，不是发送消息的授权。
