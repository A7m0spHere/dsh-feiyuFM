# R4 播放事件延迟与切歌稳定性

日期：2026-11-03，分支 `perf/playback-latency`，起点 `ef065c2`（R3 收尾）。保留 R3 的双向历史、解析所有权、预加载生命周期与计时口径，不修改推荐评分、最近 50 次窗口、成长规则或 3000ms 预取延迟。

## 一、结论

R3 的 WPF → Core → UI 等待主要不是管道或 UI 轮询本身，而是 **Core 事件循环被同步投影阻塞**：一次 `snapshot()` 约 100–360ms、一次 `next` 的 `dispatch` 约 180–410ms、400ms 心跳约 130–490ms，叠加后事件循环最长停顿 2.6s，WPF 的 `started` 行在命名管道里等待 0.77–1.27s 才被读取。

把逐曲 SQLite 查询改为批量集合后，同一真实网易云场景（预加载命中的 20s 后 next）：

| 指标 | R3（`ef065c2`） | R4 | 变化 |
|---|---:|---:|---:|
| 点击 → 标题显示 | 823–945ms | 251ms | −70% |
| 点击 → 页面显示播放 | 4314–4339ms | **767ms** | −82% |
| WPF started → Core 收到 | 789–1277ms | 60ms | −92% |
| Core started → UI 投影 | 616–1029ms | 162ms | −75% |
| 事件循环最长停顿 | 2606ms | 565ms | −78% |
| `snapshot()` 投影 p50 | 160ms | 46ms | −71% |
| `dispatch` p50 / max | 176 / 411ms | 79 / 264ms | −55% / −36% |
| 400ms 心跳 p50 | 262ms | 85ms | −68% |

目标“WPF started 到 UI 状态更新低于 1s”和“预加载命中时手动 next 低于 3s”在真实网易云测量中达成；冷打开场景仍受平台媒体打开耗时支配（见第五节）。

## 二、归因方法与证据

新增低噪声探针（只在超过阈值时记录，不写入逐曲高频日志）：

- `loop-delay`：100ms 定时器漂移，直接度量事件循环同步阻塞；
- `slow-op`：`snapshot` / `snapshot-request` / `dispatch` / `tick` / `commit` / `flush` / `stderr-write` 超过阈值时记录耗时；
- `snapshot-parts`：把 `snapshot()` 拆成 `discoveryMs` 与 `cloneMs`。

测量复用 [playback-navigation-latency.mjs](../../scripts/playback-navigation-latency.mjs)：新建隔离 DSH Web profile、真实认证 RPC、真实网易云资源、静音 WPF、程序化 DOM 点击。原始时间戳与每轮 loadedCode 校验保存在 [R4-playback-timings-20261103.json](R4-playback-timings-20261103.json)。

归因过程与证据：

1. R3 数据中 `host-command load` 的 Node 侧耗时 1169–2653ms，而宿主自身 `hostMs` 只有 2–9ms，说明等待发生在 Core 进程而不是 WPF。
2. 新探针显示 `loop-delay` 与 `slow-op` 高度相关：`snapshot` 约 100–360ms、`dispatch` 约 180–410ms、`tick` 约 130–490ms。
3. 微基准在真实库副本上确认根因：`discovery.status()` 对 95 个缓存候选逐个执行约 4 条 SQLite 查询；`describeEnvironmentProfile()` 对 233 个环境曲目逐个执行 2 条查询（**142ms/次**）；选择器对每个候选逐个读取偏好、艺人偏好、反馈（`next` 约 150ms 以上）；已批准池也逐曲查询可用性。
4. 这些投影在每次命令应答、每次 400ms 心跳、每次 UI 快轮询和每次状态发布时重复执行，于是管道读取被反复推迟。

## 三、已实施修复

| 范围 | 修改 | 影响 |
|---|---|---|
| 存储 | `src/storage.mjs` 新增 `unavailableKeys`、`environmentKeys`、`effectiveListenKeys`、`feedbackScores`、`normalizedTracksForEnvironment`、`environmentSourcesByTrack` | 一次查询替代逐曲 prepare+query |
| 发现投影 | `src/discovery.mjs` 的 `candidates`/`usable`/`recommendations` 改用批量集合 | 95 个候选从约 380 条查询降到约 4 条 |
| 环境画像 | `src/environment.mjs` 的 `describeEnvironmentProfile` 改用批量 join | 142ms → 约 12ms |
| 选择器 | `src/selection.mjs` 的 `decide()` 一次性构建偏好/反馈/可用性映射，`scoreCandidate` 支持批量上下文 | `next` 选择从约 150ms 降到约 20ms（真实库副本） |
| 去重 | `src/core.mjs`、`src/core-host.mjs` 不再重复传入与选择器相同的 `isPlayable` 可用性检查 | 每个候选少一次查询 |
| 批准池 | `src/approved-pool.mjs` 批量可用性 | 池投影不再逐曲查询 |
| 供应投影 | `src/core-host.mjs` 的 `playbackSupply` 批量环境/有效收听集合 | 快照投影进一步降低 |
| 诊断 | `src/core-host.mjs`、`src/core.mjs`、`src/runtime/evidence.mjs`、`bin/fishfm-core.mjs` 增加上述探针与字段 | 归因可复现，阈值触发 |
| 失败分类 | `src/playback/protocol.mjs`、`src/playback/host/wpf-media-host.ps1`、`src/core.mjs` 传递并记录 `downloadProgress/bufferingProgress/openElapsedMs/expiresAt/resourceAgeMs` | 区分 CDN 停滞、句柄过期与显式媒体失败 |
| 退避 | `media_open_timeout` 的不可播退避从 5 分钟降为 1 分钟 | 一次网络超时不长期判死 |
| 迟到事件 | WPF `MediaOpened` 只在 `status='loading'` 时标记已打开 | 超时后迟到的打开事件不能污染新状态 |
| 测量 | 脚本新增 GUI 顺序连点与 next→pause 场景 | 覆盖真实按钮语义 |

没有新增依赖、全局状态管理器、任务队列、缓存数据库或推送框架；未改 12s 打开超时阈值本身。

## 四、真实耗时（r4-final2，真实网易云，隔离 DSH，静音 WPF）

| 场景 | 点击→标题 | 点击→页面播放 | WPF started→Core | Core started→UI | 宿主打开 | 预加载 |
|---|---:|---:|---:|---:|---:|---|
| 1s 后 next（冷启动） | 337ms | 6526ms | 1ms | 451ms | 4484ms | 未命中 |
| 4s 后 next（冷打开） | 136ms | 1901ms | 11ms | 130ms | 847ms | 未命中 |
| 10s 后 next | 152ms | 676ms | 66ms | 117ms | 4ms | 命中 |
| 20s 后 next | 251ms | 767ms | 60ms | 162ms | 3ms | 命中 |
| 快速连点（controller×4） | 241ms | 2222ms | 0ms | 216ms | 631ms | 未命中 |
| GUI 顺序连点×4 | 1347ms | 3694ms | 1ms | 394ms | 636ms | 未命中 |
| next 后立即 pause | 262ms | —（保持暂停） | — | — | 12300ms（超时） | 未命中 |
| 上一首→下一首 | 1811ms | 3216ms | 0ms | 80ms | 1063ms | 未命中 |

- 预加载命中时手动 next 已进入 0.68–0.77s；冷打开场景由平台媒体打开耗时支配（0.85–4.48s）。
- 1s 场景的 4.48s 宿主打开是慢 CDN 但仍在 12s 内成功，未触发超时。
- 上一首→下一首仍正确（历史前进），耗时主要来自冷打开。

## 五、`media_open_timeout` 的原因与恢复

本轮真实测量中出现 1 次 `media_open_timeout`（next→pause 场景恢复播放时，同一资源 12.3s 未打开）：

- WPF 12s 内既没有 `MediaOpened` 也没有 `MediaFailed`，因此不是 URL 格式错误或显式拒绝，而是**网络/CDN 停滞**；
- 同一资源随后复现超时，说明是该资源/CDN 节点的问题，不是一次性抖动；
- 恢复路径：Core 将该曲不可播退避 1 分钟并自动选择新候选，选择+解析+打开约 4s；
- R3 的 4s/10s 场景 21s 长尾在本轮同一脚本、同一数据库副本下**未复现**（4s/10s 均正常完成），支持“远端媒体偶发停滞”而不是固定代码路径缺陷的判断；
- 新增的 `downloadProgress/bufferingProgress/openElapsedMs` 字段已进入协议与日志，但本轮未再次捕获到停滞样本，**该分类数据仍为 `unknown`**，不据此宣称已定位 CDN 侧原因。

未缩短 12s 打开超时：本轮证据不足以证明统一缩短阈值安全；只把超时后的不可播退避从 5 分钟降到 1 分钟，并补迟到打开防护。

## 六、快速切歌与命令竞争

- **GUI 顺序连点 ×4**：产生 4 个不同播放实例，全部正常完成；最后一次点击到页面播放 2.66s（冷打开）。没有出现旧实例覆盖新实例或未处理错误。
- **controller 同步 ×4**：UI 防重复语义下合并为一次有效换歌，最终实例正常播放（2.22s）。
- **next 后立即 pause**：+600ms 复核仍为暂停；12.3s 后宿主迟到的打开超时没有把播放恢复，恢复只发生在脚本显式 resume 之后。
- 单元回归覆盖：迟到 standby 结果不能认领/取消新目标、advisory 超时只终结自身、前台 load 不被后台取消拖断、宿主异常退出后恢复、旧媒体失败事件迟到。

## 七、日常原生 Desktop

本轮**未实测**：没有关闭或重启用户正在使用的 DSH Desktop，也没有强制中断。隔离 DSH Web 的真实认证 RPC、真实网易云资源与真实静音 WPF 已验；日常 Desktop 的实际加载版本与手感仍需用户现场确认。

## 八、仍需用户现场验证

1. 日常 Desktop 是否加载了本轮代码（插件重载/重启后）以及真实手感。
2. 真实平台 4s/10s 场景的 CDN 波动是否仍出现 10–20s 空窗；若出现，需要新的 `playback-error` 分类字段（downloadProgress 等）。
3. 物理鼠标/触控点击与程序化 DOM 点击的差异。
4. 远端自然结束（本轮未等待完整远端曲目，自然续播沿用 R3 的 near-end fixture 结论）。

## 九、修改文件

- `src/storage.mjs`、`src/discovery.mjs`、`src/environment.mjs`、`src/selection.mjs`、`src/approved-pool.mjs`、`src/core.mjs`、`src/core-host.mjs`：批量投影、选择器去重、失败分类与退避、探针。
- `src/playback/protocol.mjs`、`src/playback/host/wpf-media-host.ps1`：打开诊断字段与迟到打开防护。
- `src/runtime/evidence.mjs`、`bin/fishfm-core.mjs`：新字段与新探针。
- `scripts/playback-navigation-latency.mjs`：GUI 顺序连点、next→pause 场景。
- 文档：本报告、`docs/spikes/README.md`、`docs/PROJECT_PLAN.md`、`docs/CORE_CONTRACT.md`、`CHANGELOG.md`、`scripts/README.md`。

没有合并 main、没有发布 npm、没有改推荐评分、最近 50 次窗口、历史导航规则或成长逻辑。
