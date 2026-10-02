# P3 网易云首条真实播放闭环

日期：2026-10-02。环境：Windows、本机官方 DSH `0.2.0-rc.2`，现有工作区 bundle，数据库 `~/.dsh/fishfm/music.sqlite`，固定社区 API `4.40.1`。

结论：**网易云 P3 通过**。已有会话恢复、真实导入、点播、暂停、恢复、下一首、离开面板继续播放、插件停用与重新启用恢复均已操作。用户明确确认第一首有声，且暂停、恢复、换曲均正常。这不等于 QQ 或完整双平台 A01 通过。

## 实测记录

| 操作 | 可复核结果 |
|---|---|
| 启动与账号 | DSH 初始未运行，正常启动后网易云显示已登录；独立只读 Provider 探针再次 `restore` 返回 `authorized`、账号 ID 存在，无需重新扫码 |
| 真实导入 | DSH 点击“导入我的音乐”，请求 300 首，近期来源实际新增 100 首；SQLite `tracks=100`、导入批次 `source=recent`、`requested=300`、`imported=100`。来源成功且数量不足，没有伪造 300 首或声称用了喜欢列表 |
| 重启保留 | 正常退出并启动 DSH 后，100 首库恢复，点播列表从 Core 读取，无需再次导入 |
| 点播 | 界面选择《【洛天依】一封孤岛的信》，平台 ID `1319639646`，时长 204721ms；`status=playing`、`progressSource=audio`、`selectedBy=user`，音频进度到 13400ms；用户确认听到此歌 |
| 暂停 | 两次只读采样间隔 1700ms，均为 `paused=true`、`status=paused`、`positionMs=81815`，进度冻结 |
| 恢复 | 保持同一播放实例，恢复后采样位置 84312→86420ms，`status=playing`；从暂停位置继续 |
| 下一首 | 空队列时从已导入库选择另一首：《霜雪千年 (官方重置版)》，ID `2158558246`、时长 241663ms，新播放实例从 2500ms 推进；上一首历史 `effective_ms=109746`、`end_reason=skipped`、`agent_listening=0`、`audible=1` |
| 声音复核 | 用户答复“暂停、恢复、换曲都正常” |
| 离开面板 | 点击“返回对话”，悬浮条保持隐藏；相同实例位置 36296→38000ms，播放继续 |
| 停用 | Plugin Manager 关闭音乐插件；Core pid 30036、WPF pid 25836 均消失，DSH Host pid 27280 保留，侧栏音乐入口移除，100 首库保留 |
| 重新启用 | 新 Core pid 27468，Host pid 不变；`status=paused`、`paused=true`，保留第二首与 168931ms 位置、100 首音乐及 184 条偏好行；没有自动续播 |
| 搜索补充探针 | 同一生产 Provider、现有 DPAPI 会话，独立只读存储探针搜索“一封孤岛的信”，返回 5 条真实结果，包括首次点播 ID；只打印曲目 ID/标题和授权状态。该探针不是 DSH 搜索界面的验收 |

停用后的数据库仍保存最后播放快照，不能据此判断音频仍在运行；实际清理由进程消失核对。重新启用时 Core 强制暂停。账号 Cookie、音频 URL、运行库和临时探针不入库。

## 本轮修复

- 导入后“继续播放”因没有当前曲目而禁用，不能直接开启第一首。新增“开始听歌”和已导入曲目的选择/点播入口，主面板与浮层均读取同一个 Core 库。
- 设置认证 RPC 新增允许 `requestTrack`，白名单规范化平台、ID、标题、艺人与时长；不接受客户端音频句柄或凭据。
- “下一首”原本只消费调试队列。队列为空时使用本地选择器，排除当前曲目，保留禁播与冷却过滤；明确的用户换曲标为 `selectedBy=user`，暂停期间换曲仍保持暂停。
- 界面把“返回数量不足”误写成“降级来源”。现在区分近期/备用来源与目标数量不足；底层批次的既有 `degraded` 语义保留。

回归覆盖导入库投影、客户端重连后的第一首与点播、空队列换曲/排除当前曲目/禁播/暂停保持、认证点播字段过滤。检查命令：`npm run check`、`node --test --test-concurrency=2 --test-timeout=30000`、`npm run build`、`npm run audit:acceptance`；最终结果在开发路线中记录。

无 UI 的 Core 协议顺序为 `{"type":"library","id":"l1"}` → `{"type":"command","id":"p1","command":{"type":"requestTrack","commandId":"unique-1","track":{"provider":"netease","providerTrackId":"1319639646"}}}` → `pause` → `resume` → `next` → `shutdown`。这些消息发送到插件拥有的 Core stdio；不要同时对生产库另起第二个播放 Core。实际验收使用 DSH 认证设置入口。若要独立复现，应先停用插件，再启动 `node bin/fishfm-core.mjs --db <本机数据库绝对路径> --provider real --playback real`，完成后退出独立 Core 再启用插件。

## 剩余范围

本次近期来源成功，喜欢列表/用户歌单 fallback 仍只有离线证据；会员/版权限制、音频 URL 过期、长时间成长、真实多 Session、两小时运行与 QQ 接入尚未验收。结束时音乐插件启用、音乐暂停，保留账号和导入数据。
