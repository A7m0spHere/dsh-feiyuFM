# DeepSeek Music Persona — 项目规划与 MVP v0.1

- **文档状态：** v0.1 范围已收敛，可进入技术验证
- **更新日期：** 2026-09-27
- **产品定位：** Music Personality System for DeepSeek Harness
- **一句话：** 给正在 DSH 里工作的 DeepSeek 一副耳机。

## 1. 项目目标

DeepSeek Music Persona 不是一个新的音乐播放器，也不是替用户工作的 AI DJ。它是 DSH 的音乐人格系统：以用户近期常听的音乐作为 Agent 的成长环境，由本地状态、偏好和规则逐渐形成独立的音乐倾向；Agent 工作时可以自主决定听歌、选歌或暂时不听，音乐由 QQ 音乐或网易云音乐实际播放。

v0.1 要证明三件事：

1. Agent 能在 DSH 工作过程中自主听歌，并逐渐表现出不同于用户音乐环境的偏好。
2. 这项娱乐行为不干扰 DSH 正常工作，也不带来持续的额外 LLM 调用。
3. 用户随时能控制播放、静音、自主听歌和新歌探索。

## 2. v0.1 范围

### 必须交付

- 自维护的 QQ 音乐与网易云音乐 Provider；借鉴成熟项目的协议与工程设计，但不把另一个 DSH 插件作为核心运行依赖。
- 用户可连接任一支持的平台，导入近期常听音乐，目标约 200～500 首。数据接口受限时允许明确降级，不让单一平台接口阻塞整个 MVP。
- 分开维护 `User Music Environment`（用户近期音乐环境）与 `DeepSeek Music Taste`（Agent 自己形成的偏好）。
- 保存长期 `Global Taste`、短期 `Session State`、播放历史和用户设置。
- 本地选歌与新歌探索；新歌探索可关闭，并可将概率从 0% 调至 100%，默认建议 20%。
- Agent 可以自主决定是否听歌；用户明确提出的播放控制命令必须执行。
- 区分两个开关：`DeepSeek Listening`（Agent 是否继续听歌）与 `Human Playback`（用户电脑是否输出声音）。默认均开启。
- 支持 Normal、Focus、Silent、Off 四种工作模式。
- 一个独立的 Tauri 2 轻量悬浮窗：显示当前歌曲并提供基本播放控制；可拖动、置顶、隐藏、重新显示和记住位置。
- DSH 插件、音乐核心与桌面窗口解耦。桌面窗口退出或崩溃不能停止音乐核心；插件关闭不能影响 DSH 工作流。
- 正常自动听歌、自动换歌、探索、偏好和会话状态更新均不额外调用 LLM。连续两小时、用户未主动聊音乐时，额外 LLM 调用目标为 0。

### 明确不做

- Spotify、Apple Music、YouTube Music 或本地音频库分析。
- 自研完整播放器、音频理解、歌词深度分析、CLAP/MERT、Embedding 或复杂机器学习推荐。
- 每首歌由 LLM 评分、每轮把歌曲或人格状态注入上下文、持续注入歌词。
- 独立 AI 聊天、语音、屏幕视觉、物理桌宠、多桌宠、云同步、社区偏好分享或周报。
- 把桌面宠物素材、播放器 UI 或第三方 DSH 插件直接做成项目核心。社区项目只作参考；角色包兼容列为后续扩展，不是 v0.1 验收项。

## 3. 主要使用流程

### 首次使用

```text
启用插件
  → 连接 QQ 音乐或网易云音乐
  → 导入近期常听音乐（目标 200～500 首）
  → 本地去重、统计播放频次/最近度/歌手频次
  → 建立 User Music Environment
  → 以用户环境、少量随机扰动和初始人格偏置生成 DeepSeek Music Taste
  → 开始 DSH 工作会话
```

这里导入的是 Agent 的音乐成长环境，不是要求 Agent 复制用户口味。

### 日常使用

```text
DSH 生命周期事件
  → 本地 Music Policy 判断现在是否适合播放或换歌
  → 本地候选评分、重复惩罚和探索概率
  → QQ 音乐 / 网易云音乐 Provider 执行播放
  → 写入播放历史并更新 Agent 偏好
  → 向悬浮窗发送当前状态
```

决策和持久化在后台异步执行，不占用用户任务、工具或代码执行的关键路径。事件接入方式和可用事件字段由 Phase 0 验证。

### 用户控制

支持“下一首”“播放某首歌”“暂停”“别再放某种类型”“你自己选”“今天别听歌”等明确意图。Agent 可以用简短自然语言表达偏好，但不得拒绝明确播放控制命令。用户提出的限制是行为约束，不自动写成 Agent 永久偏好。

“你自己听，我不想听”只关闭 `Human Playback`，Agent 可以继续累积听歌历史和偏好；关闭 `DeepSeek Listening` 才停止 Agent 的音乐行为；`Off` 则暂停整套 Music Persona。

| 模式 | 行为 |
|---|---|
| Normal | 正常自主选歌、播放和探索 |
| Focus | 尽量保持当前音乐，减少主动动作和切歌 |
| Silent | Agent 继续听歌和积累偏好，用户侧静音 |
| Off | 暂停 Music Persona 的决策和播放 |

## 4. 核心产品规则

### 4.1 Work First

优先级固定为：

```text
P0 用户明确任务
P1 Agent 工作
P2 工具与代码执行
P3 Music Persona
```

音乐动作不能阻塞 read、edit、build、test、debug 等 DSH 工作。优先在 `session_start`、`turn_end`、`task_phase_change`、`idle`、`track_end` 等安全节点评估；这些事件实际是否存在以及事件负载如何，以 Spike 结果为准。

加入决策 Gate，避免短时间内频繁切歌：检查当前是否有歌曲、播放时长、距上次切歌时间、任务阶段变化、当前模式和 cooldown。单次工具失败或短暂状态变化不应触发换歌。

### 4.2 Local First / Token Invisible

自动播放、自动下一首、偏好更新、播放历史、Session 状态、新歌探索和桌面状态同步全部由本地逻辑完成，额外 LLM 调用为 0。只有用户主动和 Agent 讨论音乐时，才进入正常 DSH 对话流程；MVP 不启用主动人格反思。

### 4.3 Soft Autonomy

Agent 可以自主决定是否听歌和选择什么音乐，但用户拥有最终控制权。用户指定歌曲、暂停、换歌或施加临时限制时，按明确命令执行；自主性不能覆盖用户命令，也不能影响任务执行。

## 5. 功能与数据设计

### 5.1 音乐平台接口

核心使用平台无关的 Provider 契约，建议至少覆盖：

```ts
interface MusicProvider {
  login(): Promise<Account>
  getSeedTracks(limit: number): Promise<Track[]>
  search(query: string): Promise<Track[]>
  getRecommendations(seed: RecommendationSeed): Promise<Track[]>
  resolve(track: Track): Promise<PlayableTrack>
  play(track: Track): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  next(): Promise<void>
  getCurrent(): Promise<PlaybackState>
}
```

网易云优先评估近期播放/常听记录；QQ 优先验证近期播放接口。QQ 近期接口不可用或不可靠时，以“我喜欢”、用户歌单和插件运行后积累的历史构造 fallback。两家平台的登录、Cookie、搜索、推荐、VIP/vkey 或播放 URL 流程分别封装，平台差异不得泄漏进 Taste 和 Policy 模块。

参考开源实现前，核对具体仓库、文件和许可证；保留要求的版权与许可证声明。不得因为接口或开源项目暂时不可用，就扩大到 MVP 之外的平台。

### 5.2 Taste、历史与状态

MVP 使用 SQLite 保存本地数据。至少需要以下逻辑实体：

| 实体 | 主要信息 |
|---|---|
| Track | 平台、平台歌曲 ID、标题、艺人及可选流派元数据 |
| Listen History | 首次/最近播放时间、播放次数、跳过次数、Agent 选择次数、上下文计数 |
| User Music Environment | 导入来源、近期度、频次与环境特征 |
| DeepSeek Music Taste | 歌曲、艺人、流派偏好与探索倾向 |
| Session State | 会话阶段、工作上下文、当前曲目、临时权重与模式 |
| Settings | 平台选择、两个听歌开关、模式、探索开关/概率、悬浮窗设置 |

可迁移的歌曲偏好字段包括 `user_affinity`、`agent_affinity`、`play_count`、`skip_count`、`agent_select_count`、`last_played_at` 和 `contexts`。不要在 v0.1 引入复杂自然语言记忆或向量数据库。

Session 的上下文（如 coding、debugging、research、idle）可以临时影响候选评分。Session 结束后仅允许有限权重沉淀至 Global Taste，避免一次任务改变整体人格。

### 5.3 本地选歌

候选来源为用户近期音乐、平台推荐/相似歌曲/相似艺人和 Agent 的历史。先按探索率抽取“熟悉池”或“发现池”，再用本地分数排序或加权抽样：

```text
Score = DeepSeekTaste
      + UserEnvironment
      + ContextMatch
      + Novelty
      + Randomness
      - RepeatPenalty
```

v0.1 不锁死具体系数；在实际播放体验中调整。探索默认开启，建议初值 20%，设置可调整为 0%～100%。不引入 LightFM、Embedding 或大型推荐模型。

### 5.4 桌面悬浮窗

采用与 Music Core 分离的 Tauri 2 companion，优先做小型透明窗口，不做完整 Overlay。窗口提供当前歌曲/艺人、播放/暂停、下一首、隐藏/显示、置顶、拖动、位置记忆，以及 `DeepSeek Listening`、`Human Playback`、`Discovery` 和探索率控制。歌曲信息可短暂显示后淡出。

关闭或隐藏 UI 后 Core 继续运行；Companion 与 Core 通过本机 IPC 或事件通道同步状态。具体传输方式、窗口生命周期和桌面平台差异在 Spike 中验证。社区桌宠（包括大肥鱼）用于研究 DSH 生命周期、悬浮窗交互和透明窗口的实现经验，不作为 v0.1 强制依赖。

## 6. 建议架构

```text
DSH Plugin
  ├─ DSH events / user music controls
  └─ local IPC
       ↓
Music Core
  ├─ Policy & Decision Gate
  ├─ Taste / Session / Scoring / Discovery
  ├─ SQLite memory
  └─ Provider interface
       ├─ NetEase Provider → NetEase service
       └─ QQ Music Provider → QQ Music service

Music Core ── local IPC/events ── Tauri 2 Desktop Companion
```

责任边界：

- **DSH Plugin：** 接收经过验证的生命周期事件，注册用户音乐控制入口，并将事件异步交给 Core。
- **Music Core：** 承载状态机、策略、偏好、选歌、播放协调和持久化；不依赖悬浮窗是否运行。
- **Providers：** 处理平台登录、种子/候选获取、搜索和实际播放；平台特定协议留在各自适配器内。
- **Desktop Companion：** 展示并控制音乐状态，不作为音乐状态或历史的唯一来源。

建议后续代码目录（Phase 0 验证后再按实际 DSH 插件格式落地）：

```text
packages/
  core/                 # policy, taste, memory, scoring, session
  providers/
    netease/
    qqmusic/
  dsh-plugin/           # DSH events, commands/tools, IPC
  desktop/              # Tauri 2 companion
characters/             # 预留；非 v0.1 必需
docs/
```

## 7. 开发阶段

### Phase 0 — 技术验证（先做）

用最小可运行样例分别验证，结果形成可检查的结论后再扩展：

1. **DSH 接入：** 找到插件入口、稳定的生命周期事件、用户命令/工具入口；确认异步任务不会阻塞 Agent 工作，Core 退出或异常时能否安全降级。
2. **网易云 Provider：** 验证登录、种子数据（目标 200～500 首）、搜索、可播放 URL、播放/暂停/下一首和推荐候选。
3. **QQ Provider：** 验证登录、搜索和播放链路；单独核对近期播放数据及 fallback；确认可参考/复用代码的许可证范围。
4. **Desktop Companion：** 验证透明小窗、置顶、拖动、隐藏/显示、歌曲文本、播放控制、位置保存，以及 Core 和 UI 分进程运行。
5. **本地凭据：** 选定 Cookie/Token 的本地保存位置和清理方式；认证材料不得进入 Git、普通日志或错误报告。

Phase 0 完成条件：每条路径有成功/失败记录、已知限制、选定接口边界和继续/降级决定。QQ 近期播放单接口失败只触发 fallback，不阻断其他工作。

### Phase 1 — Music Core

实现 SQLite 数据模型、User Music Environment 导入、DeepSeek Taste 初始化与更新、Global/Session 分层、本地候选评分、探索率、重复惩罚、决策 Gate、模式和用户设置。用固定样例检查状态迁移与选歌规则，不在此阶段调用 LLM。

### Phase 2 — Provider 与播放闭环

实现 NetEase 和 QQ Provider，完成账号状态、候选映射、播放解析、播放控制和错误降级。至少各完成一次“登录/已有会话 → 搜索 → 播放 → 暂停 → 下一首”的端到端流程；近期数据不可用时显示实际导入数量和使用的 fallback 来源。

### Phase 3 — DSH 集成与桌面 Companion

将事件和用户命令接入 Core；打通本机状态同步和 Tauri 悬浮窗；完成两个听歌开关、四种模式、播放控制、发现率设置、隐藏/恢复和异常退出处理。验证窗口关闭不会停止 Core，插件关闭不影响 DSH。

### Phase 4 — MVP 验收与打包

按第 8 节完成验收；补齐首次设置说明、平台限制和本地数据清理方式，生成可供自己安装验证的构建产物。此阶段不扩展新音乐平台或非目标产品能力。

## 8. v0.1 验收标准

1. 用户可分别连接 QQ 音乐和网易云音乐；两个 Provider 各自完成搜索与真实播放，支持暂停、恢复和下一首。
2. 首次初始化能导入约 200～500 首近期音乐；接口限制时使用清楚标注的 fallback，保留实际导入数量和来源。
3. 本地偏好层区分 User Music Environment 与 DeepSeek Music Taste，并持久化播放历史和跨 Session 的 Global Taste。
4. DSH 工作时 Agent 可以本地自主开始听歌、选择下一首、探索新歌，也可以决定暂时不听；本地播放与偏好流程不产生额外 LLM 请求。
5. 用户能执行播放、暂停、下一首、指定歌曲、限制曲风、关闭 Agent 听歌、静音用户输出和调整探索率；明确命令优先于 Agent 偏好。
6. Tauri 悬浮窗可显示/隐藏、拖动、置顶、展示当前歌曲、展开简单控制；关闭窗口后音乐核心继续工作。
7. 关闭插件或遇到音乐平台/Core 故障时，DSH 的主要工作流仍可继续。
8. 在一次连续两小时、用户没有主动聊音乐的自动听歌过程中，额外 LLM 调用为 0。
9. 长期使用后，Agent 的选择可以与用户音乐环境出现可观察的差异；这项差异可由本地历史和偏好数据解释。

## 9. 待验证事项与决策边界

这些是 Phase 0 的工程验证项，不改变已收敛的产品目标：

- DSH 当前版本实际提供哪些事件、插件命令/工具注册和进程生命周期接口。
- QQ 近期播放/常听接口的可用性、稳定性与合理 fallback；目标仍是近期音乐环境，不要求某个特定 API。
- QQ/网易云参考项目中哪些实现可直接依赖或摘用，以及相应许可证和归属要求。
- DSH 插件到本地 Core、Core 到 Tauri Companion 的最佳 IPC 方式和进程管理。
- Cookie/Token 的安全本地存储方案和 Windows 优先的凭据体验。
- DSH 生命周期与桌面窗口/角色资源的兼容方式；大肥鱼扩展接口不是前置依赖。

若接口不可用，优先在已定范围内降级：近期记录 → 我喜欢/用户歌单/插件自身历史；Tauri UI 暂不可用 → Core 与播放闭环仍可独立交付。不得以单一技术路径失败为理由悄悄删除 QQ 或近期环境目标；需要调整产品边界时记录具体证据再决定。

## 10. 项目原则

- **Work First：** 任务执行始终高于音乐行为。
- **Local First：** 状态、推荐、记忆和策略默认本地处理。
- **Token Invisible：** 自动音乐行为的额外 LLM 调用为零。
- **Soft Autonomy：** Agent 有偏好和选择权，用户保留最终控制权。
- **可替换：** 平台接入与桌面 UI 不进入人格/策略核心。
- **渐进交付：** 先验证插件与平台的硬接口，再投入完整核心实现。
