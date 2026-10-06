# 技术架构

更新：2026-10-06，按 N20 仓库实现整理。本文维护模块职责与数据流；字段和命令见 [内部控制契约](CORE_CONTRACT.md)，生产加载版本及验收缺口见 [开发路线](PROJECT_PLAN.md)。历史探针在 [证据索引](spikes/README.md)，设计提案在 [design](design/README.md)。

## 1. 运行结构

```text
DSH 插件宿主（index.js）
 ├─ Adapter / CoreBridge：事件、工具/命令、进程生命周期
 ├─ 认证 RPC：主面板、设置页与 shell.overlay 共用控制入口
 ├─ PersonaModelService：复用 DSH 模型服务，执行低频调用
 └─ 独立 Node Core 进程
     ├─ MusicCore：播放状态、队列、用户命令、决策版本
     ├─ Provider：平台账号、导入、候选、搜索、资源解析
     ├─ 本地选择器 / 发现缓存 / 模型歌单核对
     ├─ MusicStore：SQLite、历史、成长、反馈、模型账本
     └─ PlaybackService → 同用户命名管道 → 独立 WPF 音频宿主
```

音频不依赖可见页面。隐藏悬浮条或切换 DSH 页面不停止播放；停用插件会清理其 Core 与 Playback。完整退出 UI 进程和多会话的实际覆盖程度以验收表为准，不能仅凭进程结构宣称通过。

官方桌面 DSH 的子进程启动方式、Plugin Manager 安装与认证路由见 [U5](spikes/U5-official-desktop.md)。数据目录遵循 `DSH_HOME`，默认 `~/.dsh/fishfm/`。生产入口不新增监听端口。

## 2. 模块职责与维护入口

| 模块 | 职责 | 主要入口 |
|---|---|---|
| Adapter | 事件映射、工具/命令注册、Core 启停与故障重启 | `index.js`、`src/dsh-adapter.mjs` |
| Core Host | 协调 Provider/Playback、RPC 消息、后台维护与画像缓存 | `src/core-host.mjs` |
| Music Core | 用户优先、模式、队列、决策版本与历史完成 | `src/core.mjs` |
| Provider | 登录、凭据引用、导入、搜索、候选与短期资源解析 | `src/providers/` |
| 推荐 | 输入画像、种子、发现缓存、相似图、评分与歌单核对 | `environment`、`recommendation`、`discovery`、`track-graph`、`selection`、`model-recommendations` 模块 |
| 模型功能 | 事实包、预算预留、生成/筛选、用量与调度 | `src/persona*.mjs` |
| Playback | 音频宿主进程、管道、版本守卫与真实时间线 | `src/playback/` |
| Storage / Growth | 迁移、事务、历史去重、成长重放与有界更新 | `src/storage.mjs`、`src/growth.mjs`、`src/feedback.mjs` |
| UI | 状态展示、命令与位置/动态偏好，不承载音频或成长计算 | `src/ui/client/`、`src/ui/dsh-settings.mjs` |
| 运行证据 | 脱敏请求/播放/成长采集和只读观察 | `src/runtime/`、`scripts/observe-runtime.mjs` |

网易云使用固定 `@neteasecloudmusicapienhanced/api@4.40.1`；账号与曲目 ID 不跨平台混用。QQ 代码和共享契约保留，真实接入按用户要求暂缓。第三方来源见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 3. 推荐与模型数据流

输入导入保留来源、艺人标识与覆盖率，建立独立用户环境；初始化不覆盖既有 Agent 偏好。喜欢/少推荐是另一组显式规则，不同步平台收藏，也不直接改写长期 affinity。

真实宿主默认 `llm` 推荐来源：低频模型根据代表歌曲、反馈和关系事实生成歌名/艺人，有界搜索核对后进入可执行歌单。探索池还包含网易云相似歌曲/每日推荐等真实候选，低频 `discovery-filter` 批量挑选排序。模型排名是有界评分加成，未入选候选仍可用；平台候选不冒充模型原创推荐。

本地选择器只读缓存，先过滤约束、不可用、当前曲目和冷却，再评分。`local-v5` 使用偏好、新鲜度、重复惩罚、种子关系、环境、多样性、反馈、模型排名与个人相似图。自主续播不走输入曲库回退；用户主动「下一首」在默认候选耗尽后可回退并记录真实来源。取舍见 [DECISIONS 第 28–30 节](DECISIONS.md)。

逐曲选择、控制、进度和解释不请求模型，不持续注入主聊天。总结、歌单和候选筛选是计划内低频调用，共享 token 预算、并发锁和账本，精确门控见 [契约](CORE_CONTRACT.md)。未知流派/情绪保持未知，不推断音频理解。

## 4. 用户优先、并发与故障

Core 是播放状态唯一所有者。命令按 `commandId` 去重，可用 `expectedRevision` 拒绝旧 UI 状态；播放变更递增 `commandVersion` 并取消旧解析，迟到结果不能覆盖新曲目或暂停。事件按实例及版本检查，重复结束不能重复成长。

命令应答代表接受后的状态，可能仍在 `resolving`。控制和状态读取不排在慢账号/导入工作后，stdio 持续接收消息；慢媒体打开可被暂停、停止或下一首取消。调试用 `wait` 等媒体任务收尾。

Adapter 根据真实 `session/event` 映射内部事件，只有获准的安全事件可尝试自主开始。Session 登记和短期影响隔离，共享一条音乐队列；无法确认的工作上下文保留 `unknown`。事件信封与采集见 [N7 宿主契约](spikes/N7-host-contract.md)。

Core 崩溃后桥可在下次启动时重建；音频掉线用新快照核对是否仍持有当前实例。超时/写入失败拒绝所有等待者。歌单核对、解析重试和自主替换都有预算，见 [N13](spikes/N13-crash-recovery-and-verification-bound.md)、[N20](spikes/N20-review-fixes.md)。

## 5. 播放与有效经历

Windows 音频宿主为隐藏 STA PowerShell 进程中的 WPF `MediaPlayer`，优先 `pwsh`，后备 Windows PowerShell。宿主只管理资源、声音和时间线，不选曲、不写库、不读凭据；静听使用真实音频静音，时间线继续推进。

默认在播放期间逐个打开 5 个静音、不播放的持有者，资源在临时目录生成并正常退出时删除。首曲仍冷启动；当前机器填池后加载约 0.58–0.85 秒，阈值与耗时依赖环境，不能推广成兼容性保证。参数和测量见 [N20](spikes/N20-review-fixes.md)。

`positionMs` 表示位置，`effectiveMs/agentEffectiveMs/audibleMs` 分别累计经过连续观测确认的进度。seek、睡眠、长缺口和恢复起点不按墙钟补算。用户下一首仍是推荐器选择，明确点播才是用户选择。历史完成与成长作业入队同事务，成长按实例幂等重放。

UI 进度以服务端锚点加本地时钟插值，暂停归位、切歌不串、时长封顶；展示插值不计入成长，见 [N18](spikes/N18-p2-progress-and-relations.md)。

## 6. 持久化与凭据

仓库 schema v11。曲目/来源、用户环境、Agent 偏好、反馈、历史/成长、约束/Core 状态和模型账本分别保存，实体与保留规则见契约。重启保留曲目和位置，但恢复为暂停，不伪增经历。

Cookie 在 Windows DPAPI CurrentUser 凭据文件中加密保存，SQLite 只存引用和账号状态。导入前核对实际账号身份，密文存在不代表会话有效。短期 handle 只从 Provider 传到 Playback，不进数据库、UI 或模型事实包。

歌单事实不发送平台 ID；候选筛选包含匹配结果所需的曲目键。运行证据有界且脱敏，不记录 Cookie、Token、完整媒体 URL。无法覆盖的 DSH 请求/上下文指标保持未知，A09 两小时对照仍未通过。

## 7. 客户端与验证

`src/ui/client/` 是维护源，`src/ui/dsh-client.js` 是生成 bundle；修改后运行 `npm run build:client` 或 `npm run build`。React 由宿主提供，主面板、设置页和 `shell.overlay` 共享 controller 与认证 RPC。

`preview:ui` 是 loopback 开发模拟预览，只服务白名单资源，不读生产数据库或凭据。`src/ui/bridge.mjs`、`ipc.mjs`、`window-state.mjs` 保留独立验证模块，不能据此称产品提供独立桌面窗。

检查、构建与真实环境验证的边界见 [开发路线](PROJECT_PLAN.md)；安装、更新、数据位置和排障见 [使用说明](DELIVERY.md)。
