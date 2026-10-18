# 技术架构

更新：2026-10-18。本文维护进程、模块职责和数据流；字段、数值门控与恢复细节见 [控制契约](CORE_CONTRACT.md)，部署及验收状态只看 [开发状态](PROJECT_PLAN.md)。

## 运行结构

```text
DSH 插件宿主（index.js）
 ├─ Adapter / CoreBridge：事件、工具/命令、进程生命周期
 ├─ 认证 RPC：主面板、设置页与 shell.overlay
 ├─ PersonaModelService：复用 DSH 模型，执行低频调用
 └─ 独立 Node Core
     ├─ MusicCore：播放状态、队列、用户命令与决策版本
     ├─ Provider：账号、导入、候选、搜索、资源解析
     ├─ 本地选择器 / 平台缓存 / LLM 入选歌单
     ├─ MusicStore：SQLite、反馈、历史/成长与模型账本
     └─ PlaybackService → 本机 IPC → WPF / AVFoundation 宿主
```

音频不依赖可见页面；停用插件清理其 Core／Playback。生产入口复用宿主认证路由，不新增监听端口，宿主接入依据见 [U5](spikes/U5-official-desktop.md)。结构不能替代完整退出、多窗口或并发的现场验证。

## 模块职责与代码入口

| 模块 | 负责 | 入口 |
|---|---|---|
| Adapter / Bridge | 真实事件映射、工具／命令注册、Core 启停和重建 | `index.js`、`src/dsh-adapter.mjs` |
| Core Host | RPC、Provider／Playback 协调、维护和画像缓存 | `src/core-host.mjs` |
| Music Core | 队列、用户优先、命令版本、收听完成 | `src/core.mjs` |
| Provider | 账号／来源／候选／搜索及短期资源；不选曲 | `src/providers/` |
| 推荐 | 输入画像、种子、发现缓存、相似图、评分、旧歌单核对 | `environment`、`recommendation`、`discovery`、`track-graph`、`selection`、`model-recommendations` 模块 |
| 模型 | 事实包、路线、预算预留、筛选、usage 与调度 | `src/persona*.mjs` |
| Playback | 独立音频进程、IPC、版本守卫和真实时间线；不选曲／写库／读凭据 | `src/playback/` |
| Storage / Growth | 迁移、事务、幂等、反馈和有界成长 | `src/storage.mjs`、`src/growth.mjs`、`src/feedback.mjs` |
| UI / Expression | 状态投影、命令、本机展示偏好和确定性表达 | `src/ui/client/`、`src/ui/dsh-settings.mjs`、`src/expression.mjs` |
| 运行证据 / 研究 | 有界脱敏采集与写入健康；研究工具只读导出／离线回放 | `src/runtime/`、[脚本索引](../scripts/README.md) |

网易云固定使用 `@neteasecloudmusicapienhanced/api@4.40.1`，不另起 Express 服务；QQ 保留相同契约，账号与 ID 不跨平台混用。版本、来源与许可查 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 推荐与状态所有权

导入 → 来源事实／用户环境 → 仅补缺失的 Agent 偏好。显式喜欢／少推荐与成长分开保存，候选事实按歌曲带反馈；不从未知流派、情绪或工作上下文猜信号。

默认 `filtered`：参考输入召回真实网易云候选 → `discovery-filter` 预留／批量挑选 → 按预留索引映射 → 本地只执行入选歌单。账号、批次和代次保护旧响应；普通失败可保留同账号有效旧歌单，切号／清空不能复用。旧直接生成歌名／搜索核对保留内部兼容，见 [N22](spikes/N22-platform-first-recommendations.md)。

本地选择先过滤硬约束、不可播、当前和冷却，再按 `local-v5` 的偏好、关系、反馈、重复限制与模型排名评分。自主续播不回退输入，用户主动下一首可在歌单耗尽时回退并记录来源。逐曲选择／解释／控制不请求模型，总结／歌单／筛选共用预算和账本。

Core 是播放状态唯一所有者；用户环境／反馈、Agent 经历／偏好、表达风格各自保存。U19 是当前批次的只读投影；U20 只改变本地说明，使用独立配置 revision，不改变播放 revision 或模型事实。

## 并发与故障

用户命令去重，播放变更取消旧解析并更新版本；迟到结果不能撤销暂停或新曲目，结束／成长按实例幂等。慢平台任务与播放／状态读取分开处理；重置使旧导入失效，客户端快照及查询统一去旧，细节见契约第 2–3 节。

多 Session 共享一条音乐队列，但活动会话与短期影响隔离；只允许安全事件尝试自主启动。真实事件字段与采集边界见 [N7 宿主契约](spikes/N7-host-contract.md)。Core 可由桥重建；音频断线取权威快照，中断恢复、解析与替换均有预算，暂停和换曲可以取消。

## 音频、持久化与客户端

Windows 使用隐藏 STA PowerShell 中的 WPF `MediaPlayer`，优先 `pwsh`、后备 Windows PowerShell，经同用户命名管道通信。macOS 实验性适配用 Swift `AVPlayer`、同用户 AF_UNIX socket；Helper 首次由 `/usr/bin/swiftc` 编译至私有数据目录。静听用真实音频静音，位置与有效／Agent／有声时长分开累计，seek、睡眠和失联不补计。预热配置、故障码和恢复预算只在契约第 6 节维护。

数据遵循 `DSH_HOME`，默认 `~/.dsh/fishfm/`；实体与保留规则见契约第 7 节。历史、统计和成长入队同事务，重启保留曲目／位置并强制暂停。Cookie 用 Windows DPAPI CurrentUser 或 macOS Keychain，SQLite 只存引用；加密文件存在不等于会话有效。短期媒体 handle 只在 Provider→Playback 间传递，不进 UI、数据库或模型事实。

运行证据有界脱敏，写失败必须可见；未采集的 DSH 请求／上下文指标保持 `unknown`。来源事实的本地投影不等于推荐质量，研究回放也不等于完整 Core 重演。

`src/ui/client/` 为维护源，`src/ui/dsh-client.js` 为受 Git 管理的生成 bundle，改后构建同步。React 由宿主提供；`preview:ui` 仅服务 loopback 白名单和模拟 RPC。独立 `bridge/ipc/window-state` 验证模块不代表产品交付独立桌面窗。目录、生成物和维护命令统一查 [仓库入口](REPOSITORY.md)。
