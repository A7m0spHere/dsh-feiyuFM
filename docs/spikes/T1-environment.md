# T1 用户环境与初始人格：实现与验证

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0（离线）。
- 状态：**离线实现并通过 12 项专项测试**（10 项环境/人格 + 2 项迁移）；真实账号导入与真实历史仍未验（需要 P2/P4 与账号）。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) T1；验收关联 A02（导入来源与数量如实）、A06（用户环境与 Agent 偏好分离、重启保留）。

## 交付物

| 文件 | 职责 |
|---|---|
| [`src/storage.mjs`](../../src/storage.mjs) | 迁移 v2：`tracks`、`seed_imports`、`user_environment`、`agent_preferences` 及访问方法 |
| [`src/environment.mjs`](../../src/environment.mjs) | 导入批次、来源登记、去重、环境概况（A02） |
| [`src/taste.mjs`](../../src/taste.mjs) | 固定种子初始化、有界扰动、来源偏置、偏好读取（A06） |
| [`test/taste.test.mjs`](../../test/taste.test.mjs) | 10 项：来源真实性、去重、未知元数据、确定性、重启稳定、边界 |
| [`test/migration.test.mjs`](../../test/migration.test.mjs) | 2 项：v1→v2 真实升级不丢数据；未知新版本被拒绝 |

## 环境（A02）

- 允许的来源只有 `recent` / `liked` / `playlist` / `plugin_history`，且各有中文标签（近期播放 / 我喜欢 / 用户歌单 / 插件历史）。**收藏或歌单不会被标成"近期播放"**；已存在行的来源不会被后续导入改写。
- 每次导入同时保留 `requested` 与 `imported`，不足目标即标 `degraded` 并附原因（如 `Requested 300, imported 3`）；`sufficient` 以 200 首为界。不填充、不伪造数量。
- 去重键只有 `(provider, providerTrackId)`：同平台重复计入 `duplicates`；**不同平台即使标题相同也不合并**。
- 缺失的播放次数与日期保存为 `NULL`（"未知"与"0 次"是不同事实），后续导入不会用空值覆盖已知值。
- 一个平台的导入批次收到别的平台曲目时整批拒绝：不留曲目、不留批次记录（事务）。
- 导入在单个事务内写 tracks + environment + batch，失败不会留下半截数据。

## 人格（A06）

首版参数（[DECISIONS 第 11 节](../DECISIONS.md) 记录理由，后续按数据调整）：

| 参数 | 值 | 含义 |
|---|---|---|
| `base` | 0.5 | 用户带来的曲目的起始 affinity |
| `jitter` | ±0.15 | 有界随机扰动上限 |
| `sourceBias` | recent +0.04 / liked +0.08 / playlist 0 / plugin_history 0 | 轻微初始偏置 |
| `min` / `max` | 0.05 / 0.95 | 偏好上下界，保证可比 |

- 使用 mulberry32 固定种子 PRNG；环境条目按 `track_key` 排序后处理，**结果不依赖导入顺序**。
- 同一种子 + 同一环境 → 逐条相同的 affinity（测试断言两条独立数据库完全一致）。
- 种子写入 `settings.agent_seed`；已有偏好时再次初始化是 **no-op**，重启只读回原值（测试断言重启后"一条 affinity 都没变"）。
- 艺人偏好取其已知曲目 affinity 的**有界均值**，而不是重新抽一次，避免与证据脱节。
- 用户信息不越界：即使某曲 `playCount=99`，Agent 初始 affinity 仍在 `base ± jitter` 内，且 `source='seed'` 明确标注这不是用户反馈。
- 空环境初始化出**空而诚实**的人格：0 条偏好，但种子仍被记住。

## 迁移安全

- v1 数据库在真实升级路径上验证：原有 `settings`、`listen_history`、`track_stats`、`credential_references` 数据全部保留，`schema_migrations` 变为 `[1, 2]`，重复打开不会二次迁移。
- 比当前更高的版本（如 99）直接拒绝，不盲目运行。
- 顺带修掉一个真实资源泄漏：迁移失败时原先不关闭数据库句柄，文件会被锁住（测试以 EPERM 暴露）。现在构造失败会关闭句柄再抛出。

## 本轮另外修掉的一个真实缺陷（并发下才出现）

全套并发跑时 `a dropped client connection reconnects without killing the running track` 会偶发失败（`snapshot` 20 秒无应答）。原因在**替身后端**：旧 socket 的 `close` 事件晚于新连接到达时，会把新连接的 writer 置空，于是应答写进了空气。改为只有"当前活动 socket"才能清空 writer；同时给恢复路径单独的超时预算（`recoveryTimeoutMs`，默认 20 秒，比普通控制命令宽松）——真实 WPF 宿主不受此影响，因为它严格串行接受连接（已在宿主里写明这条前提）。

连续 3 次全量运行 58/58 通过。

## 仍未验证

- **真实账号的导入**：来源判定、数量、降级路径要等 P2（网易云）/P4（QQ）接入后才有真实数据；本轮的 provider 是测试数据。
- **真实历史与插件历史的区分**：`plugin_history` 目前只是登记的来源之一，尚未与平台数据对账。
- **偏好的长期演化**：T1 只做初始化；有效进度阈值、有界更新与防自我强化属 T3，尚未实现。
- 参数（0.5/0.15/偏置）是首版取值，尚无真实听歌数据支撑。