# 技术架构草案

2026-10-04 N11：[模型歌单](spikes/N11-model-playlist.md) 替代仅展示/平台推荐作为默认产品方向。DSH LLM 服务低频输出具体歌曲，Core 验证与记账，`model-recommendations.mjs` 有界搜索核对，selector 同步执行缓存；Provider 负责平台元数据和资源，不把网易云推荐当作模型推荐。输入清空与旧成长重置分开，保留可恢复数据边界。

2026-10-03 N10：[歌曲反馈与重置](spikes/N10-feedback-reset.md) 新增独立 `user_track_feedback`（schema v9）。Core 接收显式反馈/重置/撤销命令，selector 只读反馈做有界评分，喜欢的歌曲进入熟悉池/种子；不覆盖 Agent affinity 或输入环境。重置、恢复点和命令去重记录同事务，Growth 拒绝重置边界前的旧经历；UI 读取 `insights.feedback`，不自行计算权重或同步平台收藏。

2026-10-02 N0–N3 已落地：`src/discovery.mjs` 在 facade/Host 内负责候选缓存和后台调度；selector 同步读缓存及用户环境/Agent 已知歌曲。schema v4 将历史、待处理成长与幂等应用接通；Playback 提供受连续观测限制的有效增量。生产入口采集实际请求/播放/成长，Adapter 采集实际注册，观察脚本只读报告；DSH 全量请求/上下文仍未覆盖。接口与证据见 [CORE_CONTRACT](CORE_CONTRACT.md) 及 [N3](spikes/N3-discovery-cache.md)。

2026-10-02 后续设计见 [自主听歌与推荐规划](AUTONOMOUS_MUSIC_ROADMAP.md)：Provider 验证并提供候选，Host 有界刷新缓存，selector 只读本地候选，环境与 Agent 偏好独立，Playback 提供真实进度，Core 协调有效经历与成长幂等。当前接口尚未扩展；实际变更在各任务落地时同步本文件和 CORE_CONTRACT。

2026-10-02 UI 重构：`src/ui/client/` 拆分设计 token、展示状态、controller、组件、曲库、主面板、浮层与入口；无运行时构建依赖的 `scripts/client-bundle.mjs` 生成 DSH 所需的 `src/ui/dsh-client.js`。React 仍由宿主提供，未新增播放宿主、生产监听端口或模型请求。独立 `preview:ui` 是仅绑定 loopback、只服务固定白名单资源的开发模拟预览，不读取生产库或凭据。见 [U7](spikes/U7-phl-ui-motion.md)。

2026-10-02：[网易云 P3](spikes/P3-real-loop.md) 真实闭环通过。Core Host 提供 `library` 元数据投影，认证设置状态返回导入库；主面板点播转为白名单 `requestTrack`，音频句柄仍只在 Provider/Playback 之间流动。用户下一首在队列为空时调用本地选择器，排除当前曲目并保留禁播/冷却过滤，暂停保持。以下旧阶段记录按日期阅读。

2026-09-30 官方 desktop rc.2：设置 RPC 优先用 `connection.fetch.register` 的精确 `/api/fishfm/*` 路由与 Gateway 共存，保留宿主认证；默认数据目录遵循 `DSH_HOME` / `~/.dsh`。悬浮条通过 root selector 读取活动面板、以 `[data-shell-overlay]` 为位置边界，设置页按容器宽度布局。实测见 [U5](spikes/U5-official-desktop.md)。

2026-09-29 增量：DSH Web 主界面通过 `dsh.client` / `./client` 加载 `src/ui/dsh-client.js`，注册 `sidebar.panellist`、`main`、`settings.section` 和 `shell.overlay`。设置面板与悬浮条使用 `src/ui/dsh-settings.mjs` 中基于宿主认证的 `/api` RPC，共享同一个 Core controller。NetEase provider 在 Core 内直接调用固定版本 `@neteasecloudmusicapienhanced/api@4.40.1` 读取账号和导入来源；DPAPI、SQLite 凭据引用边界不变。UI 没有独立状态库、播放服务、监听端口或模型调用。真实实例当前发现已存会话返回游客态，导入被阻止；详见 [U4](spikes/U4-quick-login.md)。

更新：2026-09-27。状态：**Phase 1 内部 Core/Storage 契约已离线实现；DSH、Provider、Playback 和 Desktop 接口仍待 Phase 0 验证。** 产品行为见 [MVP](MVP.md)，已实现契约见 [CORE_CONTRACT](CORE_CONTRACT.md)。

## 1. 模块与宿主

```text
DSH
 └─ Plugin Adapter：实际事件 → 内部事件；用户意图 → 显式命令
     └─ 异步边界
         └─ Music Core：唯一状态所有者、决策、队列、历史、偏好
             ├─ SQLite：本地结构化数据
             ├─ NetEase / QQ Provider：账号、种子、候选、搜索、播放解析
             ├─ Playback Service：音频、播放进度、静音、结束/错误事件
             └─ UI Bridge ↔ 音乐控制 UI：DSH 设置入口 + 可隐藏的悬浮面板（宿主待验证）
```

Provider 负责拿到可播放资源，Playback 负责发出声音，Core 负责决定播什么。`next()` 归 Core 队列控制；平台不各维护一条相互竞争的播放队列。这是对原对话“Provider 同时负责 play/pause/next”的细化。

Core 可以是插件托管的模块或独立工作进程；Playback 的具体后端待实验确定。硬约束是**可见窗口及桌面 UI 进程退出，不应停止 Core 或 Playback**。不能把唯一音频元素放进可关闭的 UI WebView。若选择隐藏宿主，必须验证其与可见 UI 的进程关系，不能用“窗口隐藏成功”冒充“进程退出后继续播放”。

Phase 1 的独立核心暂用 Node 24 ESM、内置 `node:sqlite` 和 npm 锁文件，已在 Windows 本机验证离线运行。音乐 UI 的产品形态是 DSH 页面内可隐藏的控制悬浮条；不创建独立桌面窗或桌宠。DeepSeek 余额鲸鱼挂件只作界面参考；Tauri 2 不在当前实现范围。

桌面宿主的实测形态（2026-09-27，见 [P0-01](spikes/P0-01-dsh.md)）：Electron 外壳启动 `dsh-desktop-host`，Host 载入 `$DSH_HOME/profiles/desktop` 并监听 `127.0.0.1:19387`；Host 自己用 `process.execPath --expose-internals` + `ELECTRON_RUN_AS_NODE=1` 启动 Node 子进程，该运行时自带可用的 `node:sqlite`。desktop profile 由应用独占，CLI 不能导出或安装；插件只能以工作区 bundle 经应用内 Plugin Manager 安装。因此 Core/Playback 作为插件拥有的独立进程、由插件按同一垫片启动，是当前唯一有实测依据的宿主方式；可见窗口是否退出不影响它们仍需在真实 desktop profile 中验证。

[P0-01 局部实验](spikes/P0-01-dsh.md)证明：隔离的 DSH Web profile 能用插件生命周期启动和清理独立 Node Core 子进程，并在慢工具执行期间保持宿主响应。[P0-04 基础实验](spikes/P0-04-playback.md)证明：本机 WPF MediaPlayer 在独立进程中能播放自生成短音频、静音续进度、发出曲终事件，并可由同用户命名管道断线重连。它们尚未验证 desktop profile、真实平台资源、正式 IPC 版本守卫或可见窗口退出，不锁定最终宿主方案。

## 2. 责任边界

| 模块 | 负责 | 输入/输出 |
|---|---|---|
| DSH Adapter | 真实事件映射、音乐命令、生命周期 | 不读取主模型内部思考；只用明确可用的结构化字段 |
| Core | 用户优先、模式、候选、队列、单一播放所有权 | 接收事件/命令，提交状态与动作 |
| Provider | 登录、凭据引用、导入、推荐、搜索、解析 | 返回规范化元数据与带有效期的资源句柄 |
| Playback | 音频播放、暂停、恢复、音量、进度 | 发出 started/progress/ended/error；不选下一首 |
| Storage | 事务、迁移、历史去重、设置与偏好 | 不保存长期有效的音频 URL；不把凭据暴露给 UI |
| Desktop UI | 曲目信息、平台状态、设置与控制、显示/隐藏 | 消费快照、发送命令，不自行累积偏好 |

## 3. 内部契约轮廓

以下是职责清单，不是已发布的 TypeScript SDK。验证后再补具体类型和可运行实现。

| 边界 | 操作/事件 | 必需信息 |
|---|---|---|
| Provider → Core | login、getAccount、logout | 账号状态、待扫码/已授权/过期；不返回明文凭据给 UI |
| Provider → Core | getSeedTracks | limit/cursor、实际来源、条目、缺失字段、是否降级 |
| Provider → Core | search、getRecommendations | 查询/推荐种子、分页、能力缺失状态 |
| Provider → Core | resolve | track key、播放资源句柄、有效期、时长/可用权限 |
| Core → Playback | load、play、pause、resume、stop、setMuted | playInstanceId、命令版本、资源句柄 |
| Playback → Core | started、progress、ended、error | 同一 playInstanceId、单调进度、错误类别 |
| Core → Desktop | snapshot、stateChanged | revision、当前曲目、模式、开关、连接/播放状态 |
| Desktop → Core | command | commandId、基于的 revision、动作、参数 |

歌曲键使用 `(provider, providerTrackId)`；展示名称不能作为主键。播放 URL 是短期解析结果，过期后重取。单个平台不支持推荐或历史时返回显式能力状态，不以空数组隐藏接口故障。

## 4. 事件与并发

内部目标事件包括 `session_start`、`turn_end`、`task_phase_change`、`idle`、`track_end`；这些不保证是 DSH 当前真实的事件名。Adapter 必须记录实际事件、负载和映射。无法可靠识别 coding/debugging/research 时使用 `unknown` 或明确的 idle，不调用 LLM 猜工作内容。

实观到的真实形状（2026-09-27，[P0-01](spikes/P0-01-dsh.md)）：`ctx.on('session/event', (session, event))` 的信封固定为 `{type, seq: number, time, data}`，负载在 `event.data` 下；`turn/end` 的 `reason` 是 `{kind: 'completed'|'aborted'|'blocked'|'error'|'max-tokens'|'interrupted'|'forked'}` 结构化对象。创建 Session 会先发出 `permission/preset`、`sandbox/mode`、`approval/policy`，可作为 `session_start` 的真实信号；`turn_end` 对应真实 `turn/end`；`idle` 与 `task_phase_change` 没有对应事件，只能由本地计时与工具调用推导，或保持 `unknown`。

DSH 回调只做轻量校验和入队，不等待平台请求、播放解析或数据库写入。队列有界，重复状态可合并；网络调用需超时、取消和有限重试。禁止无限重试影响工作或制造换歌循环。

每个本地用户配置维护一个音乐 Core 和一条有效播放队列。多个 DSH Session 共享 Global Taste；Session State 按 sessionId 隔离。用户指定的会话优先；否则最近接收明确用户交互的会话作为活动上下文，其余会话只保存状态，不抢占当前曲目。宿主无法提供可靠活动会话信息时使用通用上下文。

用户命令增加决策版本，取消旧的自主解析请求；即使旧请求稍后成功，也不得覆盖用户的新曲目或暂停。相同 commandId/ended 事件只处理一次。UI 重连先取快照，再消费较新的 revision，避免旧状态回放。

## 5. 进度、静音与历史

区分三种事实：Agent 选择了歌曲、播放时间线实际推进、音频实际向用户输出。状态字段至少包含：

- `selectedBy`：agent / user。
- `progressSource`：audio / logical。
- `agentListening` 与 `audible`：本次进度是否构成 Agent 经历、是否有声音输出。
- `playInstanceId`、`sessionId`、起止时间、有效进度和结束原因。

Silent 可使用静音音频后端或本地逻辑时钟，具体由 Phase 0 决定。逻辑时钟只用于已知时长的曲目，按单调时间推进；无法得知时长时暂停并显示等待，不伪造 ended。恢复声音时尝试解析并对齐当前进度，无法 seek 时明确从头开始并重置本次音频进度。

有效听歌阈值是待调参数，但必须以实际推进时长判断。睡眠、暂停、崩溃、离线中断不凭墙钟时间补写已听记录；重启恢复为暂停，再由明确操作或策略决定后续。对于重复通知，历史去重与偏好更新应在同一事务中完成。

Core/Playback 故障后保留可恢复状态并有限重连；UI 故障只影响展示。插件停用则停止由它拥有的音乐服务，避免后台遗留播放。

## 6. SQLite 逻辑实体

N4–N6 使用 schema v5：曲目保存有来源的稳定艺人数组，`environment_sources` 保留各导入来源事实；环境分布和 Agent 偏好分别计算。推荐刷新一次最多选 3 首种子，平台关系与账号候选各自保留来源。Core 的有界决策记录关联实际播放实例，UI 读取 `insights` 投影，不另算成长或请求模型。

| 实体 | 关键字段/边界 |
|---|---|
| tracks | provider、providerTrackId、标题、艺人、可选时长/流派；元数据带来源 |
| seed_imports / user_environment | 导入批次、来源类型、实际数量、可选频次/最近时间 |
| agent_preferences | 目标类型与键、affinity、更新来源、有界增量、初始化种子 |
| listen_history | playInstanceId、track key、selectedBy、progressSource、有效进度、audible、结束原因 |
| sessions | sessionId、可确认的工作上下文、临时权重、起止时间 |
| constraints | 用户禁播/暂停限制、作用域、创建/到期时间、原始意图的必要摘要 |
| settings | 两个开关、探索设置、工作策略、窗口位置等 |
| schema_migrations | 版本与迁移记录 |

聚合 play_count、skip_count、agent_select_count、user_affinity 和 agent_affinity 时保留来源语义。不同平台 ID 不自动合并；未来跨平台匹配另行设计。

Cookie/Token 的存储后端在 Phase 0 选择，SQLite 只保存凭据引用或必要账号状态；退出登录需清理认证材料。日志只记操作结果、错误类别、时长和去重 ID，不记录完整签名 URL、Cookie 或 Token。

## 7. 后续代码布局

以下只是拟定结构，当前不创建空包。实际 DSH 插件格式与构建方式验证后再落地。

```text
packages/
  core/           # policy, taste, scoring, discovery, session, memory
  providers/      # netease, qqmusic
  playback/       # 音频后端及进度适配
  dsh-plugin/     # 实际宿主接口适配、命令、生命周期
  desktop/        # 音乐控制面板、DSH 设置入口、状态桥接；窗口宿主待验证
docs/
```

IPC 选择基于实际宿主能力。若使用本地端口，只绑定回环、校验调用身份；无论采用哪种传输，都需要协议版本、断线快照和退出通知。此处是必要的进程契约，不要求提前引入服务框架。
