# U11：模式恢复声音与「今天停止」恢复入口修复

日期：2026-10-05。范围：`src/core.mjs`、`src/ui/dsh-settings.mjs`、`src/ui/client/controller.mjs`、`src/ui/client/panel.mjs` 及生成 bundle；文档同步 `docs/MVP.md` 第 3 节、`docs/DECISIONS.md` 第 27 节。

## 发现与复现

两个体验 bug 都由临时脚本在真实 `MusicCore` + `FakePlayback`/`FakeProvider` 上复现（脚本验证后删除，未入库）：

1. **静音/关闭切回日常/专注不恢复声音。** `setMode` 的非 silent 分支只写 `strategy`，从不恢复 `humanPlayback`；播放中也没有补发 unmute。复现输出：`setMode(silent)` 后 `humanPlayback=false, muted=true`；再 `setMode(normal)` 两者不变，且无新 `setMuted` 调用。界面模式高亮按 `settings` 推导（`panel.mjs`/`floating.mjs`），因此一直显示「静听」，按钮看起来失效。
2. **「今天停止」当天无法从 UI 恢复。** `blockUntil` 只有 `chooseSelf` 清除，而 `chooseSelf` 不在 `dsh-settings.mjs` 的 `ALLOWED` 白名单，面板/悬浮条也无入口；`setListening(true)`/`setMode`/`resume` 都不清除。复现输出：停止后重新打开自主听歌开关、继续播放、曲终均不续播；点「开始听歌」（无当前曲目）无任何反应与提示。

## 修复

- `core.mjs` `setMode` 非 off 分支：切到 normal/focus 时把 `humanPlayback` 恢复为 `true`；若正在播放则 `_invalidate()` 后补发 `setMuted(false)`（失败则停止播放并保留原错误）。
- `core.mjs` `dispatch`：`resume`/`chooseSelf`/非 off `setMode` 在无当前曲目且 `selectAutonomously()` 失败时抛错——仍被 `blockUntil` 拦截报新错误码 `autonomy_blocked`，否则报 `no_candidates`（LLM 模式按歌单状态给出具体原因，平台模式给通用原因）。会话事件等后台自主尝试保持静默。
- `dsh-settings.mjs`：`ALLOWED` 加入 `chooseSelf`。
- `panel.mjs`：「今天已停止自主听歌」提示条增加「恢复自主听歌」按钮（发送 `chooseSelf`）。
- `controller.mjs`：`autonomy_blocked` 加入业务错误清单，不误标连接中断。

## 验证

- `npm test`：353 项全过（新增 `audible modes restore sound output after silent or off`、`blocked autonomy start reports autonomy_blocked and chooseSelf restores it`；更新 4 个依赖旧静默行为的断言：模式组合、选择器空候选、适配器空环境、设置 RPC 重启保留）。
- `npm run check`（113 模块）、`npm run build:client`（bundle 重建）、`npm run build`（含调试冒烟）通过。
- 行为变更记录于 `docs/DECISIONS.md` 第 27 节；MVP 第 3 节同步修订。

## 未验/边界

- 真实 DSH 宿主中的面板提示条按钮与悬浮条错误展示未现场验证（本轮无宿主会话）。
- 悬浮条本身不渲染错误提示：被拦截的快捷控制在悬浮条上仍无可见反馈，需打开主面板查看原因；后续可考虑悬浮条内联提示。
- 生产插件未重载，修复需随下次部署生效。
