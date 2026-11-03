# R3 播放控制第二轮：双向历史与预加载一致性

日期：2026-11-03，分支 `perf/playback-latency`，修复前基线 `61fa5d4`。维持 MusicCore、Selector、PlaybackService、WPF 双播放器和 UI Controller 的职责，不修改推荐评分、成长权重或默认 3000ms 预取延迟。

## 已确认的问题与修复

1. `previous` 有固定游标，`next` 却直接调用 Selector。现在先沿同一快照前进，到最新位置才推荐；`requestTrack`、新推荐与自然续播重新锚定。追加的实际开始记录不改变导航快照。历史中间禁播/不可用会跳过，后续历史全部被阻止时返回 `no_next_history` 并保留原游标；实际媒体加载失败明确报错，保留目标位置以供后续继续导航。自然结束但没有新候选时也保留原导航方向。
2. `_prefetchNext()` 在 URL 缓存或 in-flight 命中后早退，遗漏媒体准备。现在解析和预加载独立，只有精确 handle、同一宿主代次的 ready 状态可以免除再次打开；失败仍可按需加载。回退期间优先准备历史前进目标，显式 next 不绕过历史去预取随机新曲。
3. 共享解析的 AbortSignal 原属首次后台调用，后台取消可能误杀前台。现在请求持有自己的 controller，切歌选中相同目标时先交接给前台；过时目标才取消，旧结果不能回写缓存或备用播放器。前台 4 秒超时后退役旧请求，100ms 后真正新建第二次请求，不再重复等待同一 Promise；旧请求拒绝始终有观察者。
4. 直接恢复同一实例通常不会再发 `started`，导致暂停后预取不恢复。确认直接 play 成功后显式重建预取；保持资源并发保护与暂停优先。
5. WPF `Stop-Preload` 清空 pending 却不回复原请求，原 IPC 超时会断开整条管道。现在取消会回复一次 `cancelled`；Service 的 standby token 立即失效，迟到结果不能认领/取消新目标，`PlaybackService.pause` 本身仍只发一条宿主命令，不为已 ready 资源额外取消。Fake backend 同步相同语义。
6. 本轮真实网易云测量中，Core 收到命令到接受耗时 514–1832ms，实际 DOM 只落后状态投影 2–6ms；CoreHost 在 dispatch 前后重复生成完整发现投影，已去掉播放命令的重复快照，设置命令保留更新后投影。20 秒场景还确认自动池耗尽、手动走输入曲库回退时没有预取；现在仅准备相同手动回退资源，不允许自动续播选择回退曲。此两项来自本轮计时，收益另用修订后的真实实例测量，不倒改之前样本。
7. 修订后真实测量另抓到 `preloadCancel` 在 WPF 网络流关闭慢于 2 秒时触发整条 IPC 超时，连前台 load 一起失败。仅吞取消异常不能解决，因为 Transport 已关闭连接。现在该 advisory 请求采用正常 commandTimeoutMs，超时只终结自身、忽略迟到应答；真实前台命令仍保留默认整条连接超时保护。named pipe 故障注入验证先取消超时、再晚回复，前台仍成功且连接存活。
8. 同步探针与源码核对还确认，每 400ms 的 `publishIfChanged` 会先计算完整快照，再用 revision 决定是否丢弃。现把同一 revision 判断前置，未变化时直接返回；发现变更回调仍先递增 revision，不增加缓存或改变发布条件。避免昂贵发现投影反复占用 Core 事件循环，最后用真实播放重新采样。

导航本身不写喜欢反馈、不增加有效收听。真正开始的重播仍进入最近 50 次窗口，历史与成长继续由原播放事件和实际进度结算。自动推荐防重复算法不变。

## 计时与证据口径

UI 内存环记录 `ui-click/rpc-sent/rpc-received/ui-current/ui-playing`，最多 200 条；认证 RPC 传安全 `traceId`，Core 应答带收到/接受时间。Core 日志记录选中曲目、`resource-source=cache/inflight/provider`、`load-start` 的 standby readiness 与 started；PlaybackService 记录宿主往返、`hostMs` 和宿主返回的实际 preload 命中。WPF 分别提供进入 load 的 `hostStartedAt` 与真实进度确认 started 的 `hostEventAt`，不由往返耗时倒推。按 traceId、版本和 playInstanceId 关联，不把自动续播归到上一次点击。控制器时间表示状态投影；测量脚本另核对实际 DOM，二者不混用。日志不包含媒体 URL，未新增轮询或逐曲模型请求。

测量入口为 `scripts/playback-navigation-latency.mjs`。它启动新的隔离 DSH Web profile、实际认证 RPC、挂载客户端和原生静音 WPF，记录加载路径、进程与源文件 hash；以 1/4/10/20 秒后 next、快速点击、自然续播和上一首后下一首分别观察。受控本地媒体、真实平台媒体和日常 Desktop 结果分别标注，不能互相代替。

## 验证与耗时

最终代码（含 400ms 发布前 revision 判断）上的检查：`npm test` **707/707 通过、0 失败、0 跳过**（并发 2，含 Windows 真实静音 WPF 回归）；`npm run check` 176 模块通过；`npm run build` 完成 dist 与 debug smoke；`npm run audit:acceptance` 10/10 验收项证据齐全、114 份文档 0 坏链；`git diff --check` 无输出。

真实 DSH 测量使用新建隔离 Web profile、真实认证 RPC、真实网易云资源与静音 WPF，交互为程序化 DOM 点击；同一 scope（`real-dsh-web-wpf-netease-muted`）内与基线 `61fa5d4` 对比。逐 run 时间戳、loadedCode 校验与边界见 [R3-playback-timings-20261103.json](R3-playback-timings-20261103.json)。

| 场景 | 标题显示 | WPF 确认播放 | 页面显示播放 | 预加载 |
|---|---:|---:|---:|---|
| 20s 后 next（基线 61fa5d4） | 1506ms | —（基线无精确 WPF 时间戳） | 4397ms | 无 |
| 20s 后 next（guard-next，最终） | 823ms | 2518ms | 4339ms | URL 缓存 + 备用播放器 ready |
| 20s 后 next（final-verified） | 945ms | 2420ms | 4314ms | 同上 |
| 1s 后 next（基线 61fa5d4） | 1704ms | — | 8315ms | 无 |
| 1s 后 next（final-matrix） | 1318ms | 6413ms | 7434ms | provider 解析，未命中 |
| 4s 后 next（final-matrix） | 1491ms | 20948ms | 21542ms | 首选远端媒体打开超时，换候选后恢复 |
| 10s 后 next（final-matrix） | 755ms | 21339ms | 21865ms | 同上 |
| 快速连点（基线 61fa5d4） | 904ms | — | 7671ms | 无 |
| 快速连点（final-matrix） | — | — | — | `media_open_timeout` 失败 |
| 自然续播 near-end（guard-natural，以 Core 收到 ended 为基准） | — | 1005ms | 3234ms | URL 缓存 + 备用播放器 ready |

结论：标题显示明显变快（20s 场景 1.51s → 0.82–0.95s，1s 场景 1.70s → 1.32s），但**真实播放未达到“手动切歌明显改善”**：20s 稳定场景页面播放 4.40s → 4.34s 基本持平，1s 场景 8.32s → 7.43s。稳定样本里 WPF 在 2.42–2.52s 确认开始，之后 Core 收到 started 与 UI 投影仍占约 1.8–1.9s，是剩余主要等待；Core 从收到命令到接受约 0.6–0.9s。4s/10s 场景由首选远端媒体打开超时（`media_open_timeout`，12s）主导，换候选后整次约 21s，按任务要求记为**性能未通过**，与本轮代码路径分开记录；快速连点同样出现一次 `media_open_timeout` 失败。自然续播使用 near-end fixture，不能与基线整曲样本计算改善比例。

发布前 revision 判断的复测（guard-next/guard-natural）与优化前样本（final-verified/final-natural-host-v2）差异在噪声范围内，未观察到明显收益或回退；该改动只让无变化心跳跳过完整投影，不改变发布条件。

未采集：日常原生 Desktop 未重载（`not_executed`）；物理指针点击未执行；guard-next 的远端自然结束未等待（`not_executed_remote_duration`），自然续播改用 near-end fixture 单独验证。早期样本与测试或其它测量重叠，最终样本单独运行；受控本地媒体与真实平台媒体分别标注，不互相替代。

## 修改范围

| 范围 | 文件与影响 |
|---|---|
| Core | `src/core.mjs`：导航游标、解析交接、预加载与恢复；Selector 无修改 |
| 音频 | `src/playback/service.mjs`、`transport.mjs`、`fake-backend.mjs`、`host/wpf-media-host.ps1`：standby token、精确 readiness、取消应答与仅 advisory 请求的超时隔离，不重写双播放器 |
| RPC / UI | `src/core-host.mjs`、`src/dsh-adapter.mjs`、`src/ui/dsh-settings.mjs`、`src/ui/client/controller.mjs`、生成 bundle：有界时间戳与可选 timing，不改变命令幂等性 |
| 证据 / 验证 | `src/runtime/evidence.mjs`、测量脚本与对应 Core、Service、WPF、UI/RPC 回归 |

没有新增依赖、全局状态管理器、调度框架、缓存数据库或持久化表。日常 DSH 未被强制关闭；未合并 main、未发布 npm。

## 先前材料

已读取本机 `work/diagnostics/fishfm-playback-latency.md`、`work/verify/report.md`，以及 `2501a62`、`5efe415`、`610fe09`、`61fa5d4` 的源码与提交记录。根目录 `FIX_REPORT.md` 与 `report.md` 不存在；本机 work 报告未入库，其旧版平台/宿主耗时不充当本轮测量。该报告修订前轮“next 重新锚定”行为，明确区分历史前进与推荐 next，规格见 [MVP](../MVP.md)、[CORE_CONTRACT](../CORE_CONTRACT.md)，状态见 [PROJECT_PLAN](../PROJECT_PLAN.md)。
