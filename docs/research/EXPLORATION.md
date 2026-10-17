# #10 可控探索：证据、离线对照与上线条件

关联 [#10](https://github.com/A7m0spHere/dsh-feiyuFM/issues/10)、[#7 基线](README.md)、[#9 信号语义](PREFERENCE_SIGNALS.md) 和 [#11 真实试用](TRIAL.md)。本轮交付设计和可运行对照；不改变默认 `filtered` 推荐、探索比例、调用频率或数据库。进度只在 [PROJECT_PLAN](../PROJECT_PLAN.md) 维护。

## 能计算什么，哪些仍未知

| 研究分类 | 可复核判据 | 不作的推断 |
|---|---|---|
| `familiar` 熟悉／已确认偏好 | 本批调用前有有效历史 `known=true`，或当时明确反馈 `feedback=liked` | 喜欢不等于实际听过；导出没查到历史不代表从未听过 |
| `adjacent` 有来源关联 | 不属 familiar，且 `source=netease_similar`、`seedRelated=true`，证明原候选载荷存在平台种子关系 | 关系不等于音频相似度，不说明距离远近、流派或心情 |
| `unknown` 关联未知 | 缺少以上证据，包括每日推荐、私人 FM 或只有 similar 来源而无种子记录 | 不把“没有关系记录”自动叫作大胆／跨风格／意外推荐 |
| 意外发现 | 需要真人评价新颖性和愿再听等体验；本工具不自动生成候选距离标签 | 新发现不必然等于跨风格意外；没有真人反馈就没有该结论 |

类别按 familiar → adjacent → unknown 的判据确定，每首只有一类。这里不按歌名或同名艺人猜录音身份；艺人多样性仍是名称/别名字符串口径，不冒充平台艺人 ID 或流派多样性。分类不读取研究人工评价，避免用答案调序再评价自己。

## 运行同一输入对照

```powershell
npm run research -- exploration --input scripts/fixtures/research/exploration.json --out .tmp/exploration-demo --top-k 3 --rates 0,20,70,100
```

输出 `snapshot.json`、`report.json`、`report.md`、`feedback.template.json`。输入相同、参数相同报告一致，已有输出目录不会覆盖。正式样本使用原 #7 的只读导出命令；本轮不会为了研究操作生产数据库或额外调用平台/模型。反馈文件仍绑定完整输入 hash：

```powershell
npm run research -- exploration --input .tmp/research-local/snapshot.json --feedback .tmp/research-local/my-feedback.json --out .tmp/exploration-reviewed --top-k 6
```

旧 version=1 快照继续可用。新增的可选研究字段为候选 `feedback=liked/reduced`、`seedRelated=true/false/null`，调用 `elapsedMs`，上下文 `listening/paused`。缺失保持未知，不填虚假的 false 或 0。新导出只从原调用的 `facts_json/localCandidates` 保留明确反馈和种子关系；不输出平台种子 ID，不从当前账号/曲库补猜旧关系。不读取当前 Core 状态来伪造历史暂停或自主开关，因此真实旧记录的这两项通常未知。

## 三个研究方案

所有方案先通过 #7 的生产输出解析、批次/账号匹配和共同排除，只能重排同一批已入选集合。不会把平台未入选歌曲补进自动播放池，不新增三套持久化队列。

| 方案 | 排序假设 |
|---|---|
| `recorded-rank` | 沿用保存的 LLM 顺序，作为排名前缀基线；不是 Core 最终播放顺序 |
| `familiar-first` | 明确喜欢先放；其余熟悉、有来源关系、未知依次稳定排列；少推荐置后但保留可播资格 |
| `related-diverse` | 明确喜欢先放；对熟悉与有关系候选优先不同艺人，重复艺人随后；未知、少推荐置后。只比较有依据的结构变化 |

没有固定“熟悉/相邻/意外”配额，不用随机抽样凑比例。候选不足时显示实际数量；只有少推荐曲可用时仍可保留它，禁播/不可播始终排除。新方案仅存在于研究脚本，未进入 Core 或客户端。

`rates` 允许 1–8 个互不重复的 0–100 数值。0 只保留 familiar；快照原本关闭探索或为 0 时，正数实验也不绕过该边界。已知 `listening=false` 或 `paused=true` 时所有方案为空，并说明原因。控制状态缺失时可展示离线排名，但标明 `controlsUnknown`，绝不据此授权/执行自动播放。

**冻结同一模型输出后，正探索率不等于对应的陌生曲比例。** 当前 filtered 模式把入选歌曲作为一个池，正值主要参与原模型事实中的探索偏好，0/关闭额外禁止陌生候选。回放未重新询问模型，因此 20/70/100 的同方案前缀可以完全相同；这不是三个真实线上强度实验。工具另以生产 `buildSelector` 回归核对 0/正值和禁播边界。没有把无法观察的真实 LLM 差异补造成曲目。

## 评价、成本与失败归因

各方案复用 #7 `qualityMetrics`：重复率、艺人多样性及覆盖、陌生比例及已知分母、不可播比例、愿再听、新发现、理由可信度。`humanRatings` 单列 worth/try/not-worth/unknown-or-unrated；未知与未评不能当不喜欢，也不算实际提交过的“无意见”反馈。研究人工评价只用于测量，不参与调序；原调用前的产品明确反馈才允许作为排序输入。

原调用与缓存 token 字段只报告一次，所有离线方案新增模型调用/token 都为 0。`completionRate` 是账本已结束尝试 completed/(completed+failed+cancelled+interrupted)，不是 HTTP 成功率；reserved/running 不混入分母。`elapsedMs` 是原账本 finished_at-started_at，分列已知/未知数量，不叫 HTTP 延迟或模型首字延迟。缺少记录时用量/耗时未知，不用 0 伪造性能。

| 失败位置 | 可观察结果与实际处理 |
|---|---|
| 平台无候选 | `no-platform-candidates`，保留空结果；不能据此归咎筛选模型 |
| 筛选失败／明确未选中／全部已过期或不可播 | 保留 `selectionCode` 或 `no-eligible-model-picks`，共同排除统计区分已知原因；不制造入选歌曲、不重试 |
| 关闭探索且没有确认熟悉的入选歌曲 | `no-confirmed-familiar-picks`，等待；手动下一首既有曲库回退仍由生产 Core 独立处理 |
| 账号或批次变化 | `account_mismatch/stale_candidates`；不拼接当前账号的数据，不复用旧结果 |
| 暂停／关闭自主 | `user-paused/autonomy-disabled`，所有研究顺序为空；不写回任何控制开关 |
| 数据缺失 | 权限/控制/关系/人评分别保留未知，不将其改写成平台失败、讨厌或跨风格发现 |

## 与 #4 共用的来源事实

`describeCandidateEvidence()` 输出候选 ID、研究分类和结构化 facts，种类为 `known-before-batch/explicit-feedback/platform-source/platform-seed-relation`。不附带“听懂”“心情”“跨风格”等新故事；原 LLM 理由即使存在，也不自动视为已验证事实。后续 #4 应沿同一事实合同展示既有 Core/Provider 的来源，证据缺失如实标未知。维护脚本不随 npm 包发布，产品不能直接从 `scripts/` 导入模块；接入产品时复用实际来源数据与合同，而不是复制研究样本。

## 决策与回退

所有报告的决策固定为 `keep-current-production-policy`。合成样本为 `synthetic-only`，真实快照没人评为 `awaiting-human-feedback`，有人评也只到 `manual-review-required`。多样性更高不等于命中率更好，一次少量评价不构成上线许可。此轮没有收益证据，所以保留生产策略。

只有 #7/#11 的真实样本、失败与成本对照显示可复现收益，才提出独立的小改动：说明作用点、候选/控制边界、旧数据兼容、默认行为、回归和退回原 filtered 排序的方式。既有策略保留为回退路径；不能顺带开启主动分享或提高调用预算。当前没有生产策略切换，撤销本轮研究工具不需要迁移数据库或恢复播放设置。
