# N26：最近 50 次实际开始的硬性防重复窗口

2026-10-30。用户在核对今晚所有实际播放后，明确要求“50 首内不重复”。当前交付和验收状态统一见 [PROJECT_PLAN](../PROJECT_PLAN.md)，行为见 [MVP](../MVP.md)，接口见 [控制契约](../CORE_CONTRACT.md)。

## 行为与修订

[N25](N25-recent-playback-and-approved-pool.md) 的最近 50 次窗口曾允许缺歌时按最久未播降级；[真实历史](R2-two-hour-playback-20261030.md) 已确认 9 首池造成隔 8 首重播。此次按用户新要求取消这条回退，评分标识从 `local-v6` 升为 `local-v7`。

- 自动续播、普通下一首、推荐队列及下一首的曲库回退均不得选择最近 50 次实际开始中的歌曲。只可对窗口外歌曲放宽 30 分钟时间冷却；旧内部选项不能绕过硬窗口。
- 播放器确认开始即占窗，短暂开始后跳过也算；未开始的失败不算，同一实例暂停／恢复计一次。沿用有界、跨天／重启的现有设置，不清空用户窗口、不修改 schema。明确点播仍可重播，并将新开始登记入窗。
- 小池耗尽时自动续播保持等待，普通下一首说明没有窗口外歌曲并保留当前播放；不为续播混入未批准歌曲。界面显示等待新歌，原“小池先重播”的提示移除。
- 新批准批次完成后沿用既有 `persona-finish` 入口恢复无 current 的自主播放；用户暂停／关闭听歌／停止约束仍优先。补批调度、次数、并发及共享预算不扩大，不新增逐曲模型调用。

## 已执行的验证

选歌、最近播放、入选池、兼容模型歌单和默认 filtered 链路专项 **80/80 通过**，包括：

- 100 首候选经 200 次实际开始，下一首始终不在前 50 次开始中。
- 50 首小池在每首都开始一次后等待；加入第 51 首新曲并实际开始后，最早曲目离开窗口才可再次自动选择。连续短暂开始后跳过同样占窗。
- 小池耗尽后普通下一首不能重播，经过一天也不释放计数窗口；新曲补入可继续，明确点播例外、失败不入窗和重启去重保留。
- filtered 入选池耗尽后等待，新批准批次完成自动继续；新批次不覆盖用户暂停，模型请求仅来自计划内批次筛选。

专项入口：

```powershell
node --test --test-timeout=30000 test/repeat-policy.test.mjs test/approved-pool.test.mjs test/selection.test.mjs test/recommendation.test.mjs test/model-recommendations.test.mjs test/recommendation-pipeline.test.mjs
```

本轮验证记录不把旧版本日常播放当作新规则验收。日常 Desktop 的已运行 Core 不随磁盘源码修改自动更新；是否加载新规则及真实平台补批另按 PROJECT_PLAN 记录。

全量离线回归 **582 项：579 通过、0 失败、3 项真实媒体跳过**，使用 `FISHFM_TEST_REAL_AUDIO=0` 与 `--test-concurrency=2`。另在官方 DSH `0.2.1-rc.5` 隔离 Web profile 上实跑真实静音 WPF，**23/23 通过**，结果见 [结构化摘要](assets/N26-hard-repeat-window-results.json)。该验证使用两批合成批准与本地静音音频，模型预算 0、真实模型请求 0；它不代表真实网易云召回／音频或真人推荐体验。

165 模块检查、完整构建与 debug smoke、npm 包白名单（4885 文件，34.78 MB）及 108 份文档的引用审计通过，客户端源码与生成 bundle 已同步。

```powershell
node scripts/verify-dsh-integration.mjs --runtime-node 'D:/dsh/DeepSeek Harness.exe' --runtime-root 'D:/dsh/resources/app.asar/dsh' --out '.tmp/n26-new-run' --repeat-policy
```

原生验证中 12 首批准曲各实际开始一次后，状态为 `idle`、`paused=false`、`current=null`、`lastSelection.reason=recent-window-exhausted`；普通 next 返回无候选，窗口仍为 12 次。失败媒体不入窗，插件停用清理 Core／音频子进程，重启保留暂停、窗口与两批批准；隔离宿主已关闭。
