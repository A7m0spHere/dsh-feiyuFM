# N13：Core 崩溃自愈与模型歌单核对预算修复

日期：2026-10-05。范围：`src/dsh-adapter.mjs`（CoreBridge）、`src/model-recommendations.mjs`（核对预算）、`src/core-host.mjs`（discovery 处理器）；无 UI 行为变更，不需要重建客户端 bundle。

## 发现与复现

1. **Core 进程崩溃后桥永远不会重启。** `CoreBridge.start()` 原来只检查 `this.ready` 是否存在；崩溃后该 promise 已结算、`this.child` 仍指向死进程，再次 `start()` 原样返回旧 promise，所有后续 RPC 永久失败（或挂到超时），直到用户停用/重载插件。用真实 Core 子进程复现：启动 → kill → `start()` 返回同一 pid、快照请求失败。
2. **模型歌单自动核对没有尝试上限。** 核对结果为 `partial`/`empty` 时，`tick()`（宿主 400ms 定时器）在 60 秒预算过期后就会对同一 callId 重新发起整单搜索，对确实无法核对的歌单（歌曲不存在、持续业务失败）按每分钟一次无限重试，违反项目自身的"有界"原则并可能触发平台限流。N12 修复后生产歌单 3/6 通过，其余 3 首即处于这种无限重搜状态。
3. 顺带修复：core-host `discovery` 处理器对 `refreshDiscovery` 的结果 `void` 直调，解析器工作 promise 拒绝时（如存储层故障）会变成未处理拒绝，Node 默认策略下可击穿进程；现补 `.catch`。
4. **过期句柄恢复成功后 `lastError` 残留。** 错误事件触发一次性重解析时写入 `lastError={code:'resource_expired'}`，恢复播放成功后不清除；而 `playbackPresentation` 先查 `lastError` 再查 `playing`，结果音乐正常播放时主面板/悬浮条仍显示「播放未成功」+ 待机鲸鱼娘，并保留过期错误横幅。修复：`started` 事件即播放成功的直接证据，处理时清空 `lastError`（复现脚本确认恢复后 `status=playing` 而 `lastError` 仍为 `resource_expired`）。

## 修复

- `CoreBridge.start()`：`ready` 已结算或子进程已死（`exitCode`/`signalCode` 置位）时清掉旧引用并重新 spawn；并发调用共享同一次启动。`stop()` 路径不变。
- `createModelRecommendationResolver`：每个歌单（callId）在一个 Core 进程内最多自动核对 `MAX_AUTO_VERIFICATION_ATTEMPTS=10` 次（每次之间仍保留 60 秒预算）；登录缺失的尝试不计数（没有真实搜索）；新歌单重新计数；手动「重新核对歌单」不受此限。
- `core-host.mjs` discovery 处理器对刷新 promise 补 `.catch(() => {})`。

## 验证

- `npm test`：356 项全过。新增 `a crashed core is replaced on the next start instead of failing forever`（真实子进程 kill→重启→快照可用）、`auto verification is bounded per playlist while manual re-verification still searches`、`a new playlist restarts the bounded auto verification budget`；既有「过期句柄恢复」测试补充恢复后 `lastError=null` 断言。
- `npm run check`（113 模块）与 `npm run build`（含调试冒烟）通过。

## 未验/边界

- 崩溃自愈只覆盖"子进程已退出"的路径：spawn 本身失败（如入口文件缺失，仅 'error' 无 'exit'）仍保留旧行为，下次 `start()` 返回原拒绝 promise；产品路径下 `process.execPath` + 自带入口几乎不可能出现该形态。
- 自动预算是进程内存计数，Core 重启后重新计数（每进程仍不超过 10 次），不持久化。
- 真实宿主中让 Core 崩溃再观察自愈属破坏性现场操作，未在生产执行。
