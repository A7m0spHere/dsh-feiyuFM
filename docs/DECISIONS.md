# 决策、来源与参考线索

更新：2026-09-28。

## 0. 第三方依赖与实测接口（2026-09-27）

### 依赖：`qrcode`

| 项目 | 内容 |
|---|---|
| 包名 / 版本 | `qrcode@1.5.4` |
| 许可证 | MIT |
| 来源 | <http://github.com/soldair/node-qrcode>（npm 安装，`package-lock` 记录完整性哈希） |
| 引入范围 | **仅 `scripts/login.mjs`**（开发者/运维工具）。Core、Provider、Playback、插件入口**都不引用它**，因此发布路径仍是零运行时依赖 |
| 为何需要 | **实测确认网易云不提供二维码图片**（候选路径全部 `接口未找到`），必须由客户端把 `https://music.163.com/login?codekey=<unikey>` 渲染成二维码。本机无 `qrencode`、Python 无 `qrcode`/`segno`，PIL 不含编码器 |
| 谁批准 | 用户在本轮明确选择"允许装一个二维码库" |
| 传递依赖 | `dijkstrajs`、`pngjs`、`yargs`（均为 MIT/ISC 系宽松许可，随 `qrcode` 安装） |
| 失效降级 | 渲染失败时命令仍打印二维码文本形式与登录 URL，登录流程不因此失败 |

### 实测的网易云接口（P0-02，无账号即可确认）

探测方法：参数或路径错误时服务会明确回答 `接口未找到！`／`参数错误`，因此可据此确定正确形状；正确时服务直接返回真实数据。详见 [P0-02 证据](spikes/P0-02-netease.md)。

| 角色 | 结论 |
|---|---|
| `loginQr` | `POST /api/login/qrcode/unikey`，**必须带 `type=1`** |
| `loginPoll` | `POST /api/login/qrcode/client/login`，带 `key`+`type=1`；新 key 实测返回 `801 等待扫码` |
| `accountInfo` | `POST /api/nuser/account/get`；未登录如实返回 `account:null` |
| `search` | **GET** `/api/search/get/web`（查询串传参；表单体传参会被拒） |
| `resolve` | `POST /api/song/enhance/player/url`，`ids=[id]`+`br`；未登录 `url` 为 null |

**我原先的假设被实测推翻**：`POST /api/login/qr/key` 返回 `404 接口未找到`，真实路径是 `/api/login/qrcode/unikey`。这条更正写进了端点 profile 与证据文档，`CONFIRMED_ROLES` 只列实测过的角色。

仍未验证：802/803 的确切语义与 803 的 cookie 字段名、需要账号的 recent/liked/playlists、weapi 加密路径。

## 1. 来源与证据边界

主要来源：[寻找音乐插件](chatgpt-conversation://6ab7630d-46cc-83ea-a686-7bfa7ccbb972)。本次通过会话读取工具取得 5 组往返，包含用户对双平台、近期音乐、探索率、悬浮窗、自维护方案的明确说明，以及完整最终 MVP。工具未提供更早分页；不声称已读取返回范围之外的历史。

本地依据为原提交 `6e1067b` 中的 `README.md` 和 `docs/PROJECT_PLAN.md`。开始整理时，这两个文件在工作区已删除；本次按用户“继续优化整理本地文件和文档”的要求重建并拆分，没有恢复旧稿作为另一套并行规格。

引用对话里的 `chatgpt-content-reference` 是缺少原始目标 URL 的引用占位符，不能作为可核查证据。本轮是文档整理，没有重新联网核验第三方代码、许可证、接口或性能。

## 2. 范围收敛

| 决策 | 当前结论 | 来源与状态 |
|---|---|---|
| D01 平台范围 | v0.1 同时支持网易云、QQ；用户可只连接其中一个 | 用户明确要求，取代早期单平台建议 |
| D02 初次导入 | 近期常听目标 200～500 首，允许明确来源的降级 | 用户要求近期几百首；最终 MVP 允许 fallback |
| D03 自维护 | 参考社区实现，自维护平台适配与桌面层 | 用户明确倾向；不强制依赖其他 DSH 插件 |
| D04 桌面 UI 方向（已由 D11 修订） | 原记录把桌宠窗口当成 UI 产品方向并暂定 Tauri 2 | 依据当时对话中的助手建议；实现方案未验证 |
| D05 独立偏好 | 用户环境与 Agent Taste 分离；Global/Session 分层 | 最终 MVP；具体参数待实现验证 |
| D06 零新增请求 | 日常音乐行为两小时新增 LLM 请求为 0，禁用主动反思 | 最终 MVP 硬验收；不沿用早期“初始化可调用一次”建议 |
| D07 探索 | 默认开启、20%、用户可设 0%～100% | 用户要求可调；20% 来自最终 MVP 默认值 |
| D08 默认角色（已由 D11 撤销） | 原记录认为 v0.1 需要一个默认角色 | 来自旧版 MVP 文案；经用户后续澄清不作为产品要求 |
| D09 UI 生命周期 | 隐藏、关闭或崩溃 UI 后音乐核心继续 | 最终 MVP；继续播放所需宿主方式待验证 |
| D10 项目名称 | 肥鱼电台 FishFM；仓库 `dsh-feiyuFM`；DeepSeek Music Persona 保留为定位描述 | 2026-09-27 按用户要求命名并创建公开仓库；SeekFM 为历史用名，npm 发布与许可证另行确定 |
| D11 音乐控制 UI | v0.1 是可隐藏的音乐控制悬浮窗，不做桌宠；余额鲸鱼挂件只作 UI 参考；Tauri 2 未锁定 | 用户 2026-09-28 澄清；依据现成余额挂件截图/README；无代码/素材复用 |
| D12 状态视觉动态 | 鲸鱼娘示意图是非交互式音乐状态视觉；待机/听歌/切歌可切换图像姿态并轻微浮动 | 用户 2026-09-28 明确希望动态；用既有 Codex 生成图，不引入宠物行为 |
| D13 DSH 最新版兼容边界 | `0.2.0-rc.1` PHL Web profile 已加载 bundle 并启动 Core；工具调用、停用与 desktop profile 仍未验，不扩展为全版本兼容声明 | 本机 PHL 运行时、官方发行说明与插件/工具 API 文档（2026-09-28）；工具取消信号已接入；见 [P0-01 版本复核](spikes/P0-01-dsh.md) |

## 3. 本次补充的工程约定

以下是为了让需求可实现、可验收而增加的设计约定，**不是用户在原对话中逐项确认的事实**。保持产品范围不变，可随技术验证调整并记录理由。

- 拆分 Provider / Playback / Core：解决平台接入、音频输出和选歌队列混在同一接口的问题。
- 明确两个开关四种组合、暂停保持、Off 行为与临时约束期限：防止自动事件覆盖用户控制。详细规则只维护在 [MVP 第 3 节](MVP.md)。
- 用户点歌遇到已有禁播约束时需要明确例外；不得悄悄覆盖用户限制。
- 静音经历与可听播放分别记录；停止、失败或重启不凭空累加偏好。
- 单一队列、多 Session 状态隔离、命令去重与决策版本：避免抢播和迟到请求覆盖用户命令。
- 导入默认请求 300 首；不足如实展示；未知元数据不编造。
- 当前 Windows 环境优先验证；Tauri 2 是未验证候选之一，不代表已选定方案；其他系统没有已验证支持承诺。
- 零新增 LLM 请求和零 token 并非同一指标：静态工具描述是否消耗上下文需单独记录。

## 4. 参考项目清单（全部待核实）

这里保存原对话提到的名称和调研目的，不声明当前可用性。带 owner 的 GitHub 地址仅由对话标识推得，尚未打开验证；无 owner 的名称不猜测仓库地址。

| 对话线索 | 调研目的 | 使用前需要核实 |
|---|---|---|
| `dsh-netease-music` | 平台登录、Cookie、推荐、种子与解析流程 | 仓库归属、当前接口、依赖版本、代码许可 |
| `@dsh-external/dsh-music` | QQ 登录、搜索、歌单、vkey | 包与源代码对应关系、权限限制、维护状态、许可 |
| `NeteaseCloudMusicApi` / QQMusic API 项目 | 平台接口线索 | 当前维护源、版本、账号能力与失败路径 |
| [FuqiangCraft/dsh-desktop](https://github.com/FuqiangCraft/dsh-desktop) | DSH 与原生桌面边界 | 实际协议、进程生命周期、可复用代码范围 |
| [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 右下角鲸鱼挂件、状态气泡、菜单与隐藏交互；主 UI 参考 | 2026-09-28 查看 README 与 `whale-widget-prompt.md`；仅参考结构/颜色/交互，不复制代码或美术素材 |
| [133563825as-ai/dsh-api-dashboard](https://github.com/133563825as-ai/dsh-api-dashboard) | 余额看板、圆角状态卡、分组设置卡与阈值控制 | 2026-09-28 查看 README 和 `docs/screenshots/3-dashboard.webp`、`5-settings-whale.png`、`6-whale-tab.webp`；仅作界面参考 |
| `Claudio FM` / `Decky Music` | 双平台候选池、探索率、统一适配思路 | 仓库归属与许可，未确认许可前只作设计研究 |

调研优先顺序：真实 DSH 宿主 → 两个平台 → 独立播放 → 音乐悬浮控制 UI/窗口宿主。余额挂件只提供信息层级和交互参考，不能把余额业务或宠物功能扩进 MVP。

## 5. 本次文件整理

原来的单份长规划拆为产品规格、架构、Phase 0 清单和本文件；`PROJECT_PLAN.md` 保留为路线入口，README 提供导航。新增项目级 `AGENTS.md` 指向这些事实来源，避免后续 Agent 重复恢复旧建议。

保留现有 `.gitignore`。没有创建空 `packages/`、下载参考仓库、生成素材、安装依赖、选择项目开源许可证或宣称技术验证通过。

## 6. 公开仓库与跨设备协作

用户随后要求命名并创建公开仓库，用于跨设备开发。仓库地址为 [A7m0spHere/dsh-feiyuFM](https://github.com/A7m0spHere/dsh-feiyuFM)，默认分支 `main`；开发分支采用 `codex/` 前缀。项目名称沿用 DSH 社区常见的 `dsh-` 前缀，FishFM 将大肥鱼形象与音乐主题结合。

本次命名参考了 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) 和 [dsh-music-player](https://github.com/kendu76/dsh-music-player) 的公开仓库名称；不代表前述参考项目的功能、许可与性能验证已经完成。跨设备操作说明维护在根目录 README。

## 7. 开发路线细化

2026-09-27，按用户要求细化后续路线：Phase 1 先实现最小控制核心，Phase 2 提前接入真实 DSH 和网易云形成首条播放闭环，再完成 QQ；完整偏好成长与桌面体验放在 Phase 3。该调整只改变工程顺序，双平台、独立人格和零新增 LLM 请求的 v0.1 范围不变；默认角色范围后由 D11 修订。

路线增加任务依赖、对应验收项、失败处理、跨设备交接和干净环境安装验证。P0-04 先使用独立测试音频验证宿主，再复测平台资源，消除 Provider 与 Playback 的循环依赖。所有实现和实验仍为未开始；本次没有执行技术验证或引入依赖。

## 8. Phase 1 离线实现选择

2026-09-27，在本机发现 DSH desktop profile (`C:\Users\86137\.dsh\profiles`)；runtime 清单与 `dsh.CMD --version` 显示 `0.1.7-rc.2`，可读取的 `dsh-shell` 和 `dsh-hook-protocol` 包为同版本。部分 desktop profile 包链接不可解析，未在其内安装插件；在隔离 Web profile 实测 `session/event` 类型、工具自调用、慢调用期间宿主响应和独立 Core 子进程的加载/卸载，详见 [P0-01](spikes/P0-01-dsh.md)。真实用户命令和 desktop 接入仍未验证。

控制核心暂用本机 Node 24.14.0 的 ESM、`node:test`、`node:sqlite` 和 npm 零外部依赖；真实运行 SQLite 迁移与重启测试后才添加代码包。此选择只适用于 Phase 1 离线核心，不锁定 DSH SDK、IPC 或真实播放后端。Node 24.14.0 对 `node:sqlite` 给出实验性警告，后续宿主确定时需重新评估版本或驱动。来源：[Node 24 SQLite 文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)、[Node test 文档](https://nodejs.org/docs/latest-v24.x/api/test.html)、本地 `runtime.json` 和 `npm test` 输出。

播放宿主基础实验另用本机 WPF `MediaPlayer` 播放自生成音频，验证暂停、静音、曲终和父进程退出后的存活，详见 [P0-04](spikes/P0-04-playback.md)。WPF 是 Windows 独立进程候选，不是已选定的生产音频后端；真实平台资源、IPC 与可见 UI 进程边界仍需验证。

P0-04 随后用同用户 Windows 命名管道连接独立 WPF 播放进程，验证暂停、静音、断线重连、静音整曲曲终与停用；IPC 方向有局部实测，但协议版本、真实音频资源和桌面 UI 边界仍待正式适配。[P0-06](spikes/P0-06-local-data.md) 还验证了 DSH 凭据服务保存用户级 DPAPI 密文 grant；首轮 Windows 凭据方向是 DSH 凭据记录加 DPAPI，SQLite 只存引用，真实平台登录和 desktop profile 尚未验证。

## 9. F1 桌面宿主与工具链核对（2026-09-27）

按用户要求继续完成 Phase 1，本轮只补齐 F1 未闭环的「宿主与工具链结论」。核对方式是只读检查运行中进程、安装内代码与 DSH 自带 node 垫片的实测输出，证据与命令见 [P0-01 桌面核对](spikes/P0-01-dsh.md)。

| 结论 | 依据 | 状态 |
|---|---|---|
| 宿主运行时为 Electron 44 外壳加 `dsh-desktop-host`，Web 服务固定 `127.0.0.1:19387` | 运行中进程命令行、`dsh-desktop-host/lib/index.js` | 已实测 |
| Core 的 `node:sqlite` 可直接用宿主自带运行时，无需另装 Node | `ELECTRON_RUN_AS_NODE=1` 运行 `runtime/bin/node.cmd`，建表读写通过 | 已实测 |
| Phase 1 的 `check`/`test`/`build` 在宿主自带运行时上可执行 | payload Node 24.21.0 与 Electron-as-node 24.18.1 各跑一遍：8 模块检查、14 项测试全过，payload 上 `build` 成功 | 已实测 |
| 插件启动独立 Node 进程应复用宿主自身的垫片（`process.execPath --expose-internals` + `ELECTRON_RUN_AS_NODE=1`） | `dsh-desktop-host` 启动包管理器时即如此 | 已实测 |
| 权威事件表是 `SessionEventMap`；内部目标事件中只有 `turn_end` 有同名真实事件 | `dsh-agent-preset-registry/lib/typert.host.js` | 已实测 |
| 命令入口为 `ctx.tools.register` 与 `ctx.commands.register`，两者都返回 disposer | `dsh-tools`、`dsh-commands` 的 `lib/types/*.d.ts` | 已实测 |
| desktop profile 由 Electron 应用独占，CLI 不能导出或安装；插件只能经应用内 Plugin Manager 安装，新 bundle 可经 HMR 生效、替换包需重启 | CLI 两次拒绝并保持文件哈希不变；官方 `cordis-plugin-development` 技能 | 已实测 |
| 插件停用会停止其拥有的音乐服务，宿主继续工作 | 隔离 profile 宿主中热卸载探针：disposer 运行、`command-disposed`、子进程退出码 0，宿主仍监听；重新启用后取得新子进程 | 已实测（隔离宿主） |
| `tool-plugin-manager` 行默认 `disabled: true`，故 Agent 默认没有 `plugin_manager` 工具 | `dsh-base/cordis.patch.yml` | 已实测 |

本轮尝试过手工向 `profiles/desktop/cordis.patch.yml` 插入插件行，运行中的应用未热加载；该文件已按备份逐字节还原。官方文档明确要求不要手写 profile 文件，因此不再把这条路径作为方案。真实 desktop profile 中的插件激活、真实事件观察与停用清理仍为未验证，需要用户经 Plugin Manager 安装探针 bundle 后复测。

本轮同时新增了可安装的探针 bundle（`spikes/P0-01-desktop-probe/`）与管道客户端样例，两者只用于验证，不是产品插件。

## 10. P1 独立 Playback 的实现选择（2026-09-27）

用户要求"先把项目做完再统一测试"，因此按路线继续推进 Phase 2。P1 的选择与依据：

| 决策 | 结论 | 依据 |
|---|---|---|
| 音频后端 | 隐藏 STA PowerShell 进程 + WPF `MediaPlayer`，经同用户命名管道控制 | P0-04 已实测该后端可播放、静音续时间线、发曲终事件、断线重连；本轮补齐协议与契约 |
| 进程归属 | 宿主由音乐服务（将来的插件）启动并拥有，父进程不是 UI | 「退出 UI 后继续播放」要求可见窗口不承载声音；smoke 实测 UI 进程来去不影响时间线 |
| IPC | 命名管道 + 协议 v1（版本校验、命令/事件白名单、快照） | 复用 P0-04 方向；本轮补 `protocol` 校验、`id` 配对、`state` 快照 |
| 断线恢复 | 恢复时向宿主要权威 `snapshot`，不用本地缓存 | 实测缓存旧快照会造成假的 `playback_host_lost` 并误杀正在播放的曲目 |
| 平台音频 | 暂不接入，先用自生成 WAV 验证 | 平台资源属 P2/P4；WAV 足以回答 P1 的四个完成条件 |
| 测试音频 | 纯 Node 写 PCM WAV，不引入 FFmpeg | 不新增外部依赖；`scripts/make-tone.mjs` |

本轮实测暴露并修掉三个真实缺陷：并发命令互相拆连接导致 `host_unavailable: ENOENT`、重连误用过期状态、`ended` 缺少位置。详见 [P1 证据](spikes/P1-playback.md)。

## 11. T1 参数与数据边界（2026-09-27）

用户要求"先把项目做完再统一测试"，Phase 3 的 T1 因此先落地离线部分。首版参数与其理由（按路线要求记录数值，供后续用真实数据调整）：

| 参数 | 取值 | 理由 |
|---|---|---|
| 起始 affinity `base` | 0.5 | 中性起点；偏好差异应来自经历，而不是初始化就分出高低 |
| 有界扰动 `jitter` | ±0.15 | MVP 要求"少量有界扰动"；上限小于来源偏置与其他因素的影响空间 |
| 来源偏置 | liked +0.08、recent +0.04、playlist 0、plugin_history 0 | "我喜欢"是用户明确表达，权重最高；歌单与插件历史只是存在，不给偏好信号 |
| 上下界 | 0.05–0.95 | 保留可比较的取值范围，同时避免 0/1 让后续更新失去空间 |
| 种子存储 | `settings.agent_seed` | MVP 要求保存随机种子，使重启不重塑人格 |

数据边界（对应 A02/A06）：

- 用户环境与 Agent 偏好分表存放；导入只写环境，初始化只写偏好，互不覆盖。
- 缺失的播放次数/日期保存为 `NULL`，不写 0；未知与"0 次"是不同事实。
- 去重只按 `(provider, providerTrackId)`；不同平台不凭标题合并（MVP 第 2 节）。
- 导入记录 `requested` 与 `imported` 两个数字，不足即标降级并写明原因，不把目标数量当作结果。

这些取值尚无真实听歌数据支撑，[T1 证据](spikes/T1-environment.md) 已列为待调项。

## 12. T2 选歌参数与两种候选来源（2026-09-27）

选歌按 MVP 第 4 节的顺序执行：**先过滤禁播与已知不可播 → 再按探索率选池 → 最后评分**。参数与理由（按路线要求记录数值，待真实数据调整）：

| 参数 | 取值 | 理由 |
|---|---|---|
| 中性偏好 | 0.5 | 没有数据的曲目不应因"没数据"而被系统性压低 |
| 新鲜度加成 | +0.08 | 与偏好差异同量级，让未播曲有竞争机会但不足以翻盘 |
| 重复惩罚 | ×0.45 每次（6 小时窗口） | 指数衰减；6 小时大致对应"同一段工作里不重复" |
| 冷却 | 30 分钟硬排除 | 刚播完的直接不作为候选，比"分数低一点"更符合直觉 |
| 随机项 | ±0.05 | 仅用于打破平局，不得盖过偏好差异 |
| 历史窗口 | 最近 50 条 | 有界读取，避免历史越长越慢 |

两项工程决定：

- **候选来源互斥且显式**：`selectionMode` 只有 `environment`（产品路径，从用户环境实时读取）与 `queue`（Phase 1 固定候选调试入口）。不设"两者混合"，避免无法回答"这首从哪来"。
- **工作上下文暂不参与评分**：MVP 提到按工作上下文评分，但路线同时要求"无法可靠识别时用 unknown，不调用 LLM 猜工作内容"。T2 因此不引入该维度——少一个假装知道的信号，比多一个乱猜的信号更符合验收要求。接入 I1 的活动 Session 后需要重新评估。

本轮修掉一个真实逻辑错误：`recentPlays` 原先用 `Math.max(0, ended_at)` 初始化，会把小于 0 的时间戳改写成 0，从而把冷却窗口算短；已改为用行自身的值初始化。

## 13. T3 成长参数与"永不下降"的后果（2026-09-27）

MVP 要求"完成有效进度可有限更新 Agent 偏好"，且"跳过不等于讨厌、平台失败不算负面偏好"。首版参数：

| 参数 | 取值 | 理由 |
|---|---|---|
| 有效进度阈值 | `min(30 秒, 时长 × 50%)` | 短曲目按比例、长曲目按绝对下限，避免 3 分钟歌必须听 90 秒才算 |
| 单次更新上限 | 0.03 | 一次收听不主导偏好；与 T1 的 ±0.15 初始化噪声同量级，意味着**需要多次收听才能表达偏好**，这是刻意的 |
| 跳过权重 | ×0.5 | 听了没听完，证据弱一半 |
| 静音权重 | ×0.6 | 静音经历真实但强度低 |
| 衰减 | 每天 2% 向 0.5 | 时间稀释偏好 |
| 上下限 | 0.05 / 0.95 | 永不触顶或触底 |

三项工程决定：

- **成长只做非负更新**。MVP 明确"跳过不自动等于讨厌""平台失败不算负面偏好"，所以成长从不降低 affinity。**这条规则的直接后果是：衰减成为必需而非可选**——若没有衰减，非负更新会单调累积。衰减已实现、已接入宿主的定时维护（`maintenanceIntervalMs`）并有测试守着"到点衰减"与"关闭后停止"，因此偏置会随时间回落。
- **"用户播放不更新 Agent 偏好"是硬门控而非权重**：`selectedBy !== 'agent'` 直接拒绝更新。用户点播是用户的行为证据，不是 Agent 的经历。
- **成长策略放在 Core 之外**：Core 只上报"一次已记录的收听"，是否改变偏好由 `growth.mjs` 决定。这样"什么算收听"和"收听改变什么"可以分别测试与调整。

本轮修掉两个真实缺陷：选择器只返回 key 导致 `durationMs` 丢失（短曲目永远无法计入成长，产品路径上成长实际不会发生）；初始化在有偏好后完全 no-op，导致后到的导入没有 preference 行、只能按中性分参与评分。后者改为**只补缺失行、绝不覆盖已有行**。

## 14. 多 Session 与临时会话沉淀（2026-09-27）

MVP 要求"多 Session 不抢占播放"（A08）与"临时 Session 权重只少量沉淀至长期偏好，并设上限"（第 4 节 / A06）。首版参数：

| 参数 | 取值 | 理由 |
|---|---|---|
| 活动窗口 | 5 分钟 | 与"用户正在这个会话里工作"的直觉一致；更短会让切换会话时音乐停摆 |
| 遗忘时间 | 30 分钟 | 注册表有界，不随会话数无限增长 |
| 最大跟踪会话数 | 32 | 硬上限；超限淘汰最久未见者 |
| 临时会话阈值 | 10 分钟 | 更短的会话视为"临时"，其活动只算 0.5 权重 |
| 每会话每曲上限 | 8 次更新 | 上限≈8×0.5×0.03≈0.12，即一个短会话最多把一首曲子推高约 0.12 |

两项工程决定：

- **活动会话的平局用单调序号打破**：同一毫秒内两个会话都有事件时，后记入者胜。测试暴露了原先的 `>` 比较会让先记入者一直获胜。
- **上限自记而不推断**：最初从 `listen_history` 行数推断会话影响，导致**直接调用成长逻辑时上限永不生效**——契约把"必须先写历史"这个隐含前提藏了起来。现在由成长逻辑自己在同一事务内累加到 `session_influence`，并用测试断言"记录的influence 与应用的更新数一致"。

顺带修掉一个真实缺陷：会话上限的拒绝分支里 `...verdict` 展开在 `reason` **之后**，把"已达上限"的原因覆盖成了"达到有效进度阈值"——调用方会看到一句与事实不符的解释。现在拒绝原因不会再被覆盖。

**未验证**：真实 DSH 会话对象的标识字段名。P0-01 未记录、类型声明不在可读路径，因此 `sessionIdOf()` 依次尝试多个候选字段，取不到时返回 null 并记录该对象的键名，供下一次真实运行确认——不猜字段。

## 15. 桌面窗口：工具链现状与 DPI 单位（2026-09-27）

**工具链实测**（未安装任何东西）：`rustc`/`cargo` **1.95.0** 与 `rustup` 已装，WebView2 运行时 **154.0.4258.37** 存在——Tauri 的两大 Windows 前置齐备。但 **crates.io 不可达**（本环境网络多次受限：网页抓取被解析到非公网地址、`github.com:443` 被重置、本次 cargo 探测超时），因此**没有完成 Tauri 构建**，也不生成空 Tauri 工程充数。结论：**Tauri 的窗口 API 仍未验证，A07 不勾选**。

**窗口行为用 WPF 探针实测 10/10**（透明背景、无边框、置顶、点击穿透 `WS_EX_TRANSPARENT`、位置、缩放、多屏信息、托盘显示/隐藏）。注意其边界：**它证明的是操作系统支持这些行为，不等于所选框架一定暴露该能力。**

**一个真实发现（影响 U1 位置记忆）**：本机是 **125% 缩放**，而 **WPF 窗口坐标是设备无关单位，`GetWindowRect` 返回物理像素**——请求 `(120,140)` 时 OS 报 `(150,175)`，比值正好 1.25。

决定：**位置记忆必须记录并存取缩放比**。`restoreWindowState` 在同缩放时原样恢复；缩放变化时**按比例换算**（来源标为 `rescaled`）并记录新缩放；只有换算后仍不可见才回退到默认位置。这条不是理论问题——探针第一次跑就报了这个"FAIL"，直接对应"DPI 变化后窗口跑到屏幕外"的真实故障。

另记一条探针自身的教训：`$results['x'] = Report ...` 会把函数内的 `Write-Output` 一起捕获成返回值，导致**逐项输出全部消失、只剩汇总行**。改用 `Write-Host` 后才可见。这类"探针看起来通过了但什么都没测"的陷阱在本项目已出现多次（见 A09/R2 与 soak 的三个坑）。

## 16. UI 产品方向修订（2026-09-28）

用户明确澄清：FishFM 不是桌宠，前端应参考“DeepSeek 余额小鲸鱼挂件”现成插件，而不是宠物产品或其功能。产品本身仍是音乐控制插件；界面可借用右下角常驻标记、左侧信息气泡、三点菜单、快捷控制与分组设置卡，但不做喂食、随机台词、角色动画或宠物状态机。

主要参考是 [`MeteorNOX/DeepSeek-Balance-Whale-Widget`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)：`whale-widget-prompt.md` 给出气泡挂件布局与视觉参数（描边 `#203170`、正文 `#536ba9`、提示 `#9fb0d9`、三点菜单、可隐藏）；本轮查看了仓库 README、`whale-widget-prompt.md`、`assets/DSH2.png` 和 `PROVENANCE.md`。另参考 [`dsh-api-dashboard`](https://github.com/133563825as-ai/dsh-api-dashboard) 的余额卡和设置截图。FishFM 将余额/用量信息替换为曲名/艺人、播放进度、播放/暂停/下一首、DeepSeek Listening、Human Playback 与探索率。

只作 UI 参考，不复制代码或角色素材。`PROVENANCE.md` 明确声明余额挂件仓库的 `assets/**` 不属于 MIT 许可范围；FishFM 原型不使用其图片或音效。用户随后要求使用此前生成的鲸鱼娘图并加入动态展示，三张 Codex 生成图已复制到 `prototypes/assets/`，仅演示待机/听歌/DJ 姿态切换，来源映射见 [原型素材说明](../prototypes/ASSETS.md)。这不是桌宠：不增加喂食、抚摸、随机台词或主动宠物状态机。Tauri 2 仍未锁定；Core/Playback 独立于可见 UI 的约束不变。本决定取代 D04 与 D08 中的宠物产品/默认角色范围，并要求同步 [MVP](MVP.md)、[ARCHITECTURE](ARCHITECTURE.md)、[PROJECT_PLAN](PROJECT_PLAN.md)、[DELIVERY](DELIVERY.md) 和 U2 证据说明。


## 17. 先提供 DSH 主界面设置入口（2026-09-29）

用户要求可以从 DSH 主界面打开交互 UI 进行设置。本轮使用已安装 0.2.0-rc.1 的正式客户端模块与插槽，将侧栏主面板和设置页连接到同一个 Core；使用宿主 Connection 的认证 RPC，不额外开端口或修改宿主源码。面板视觉采用蓝灰色唱片与分组控件，没有复制第三方 UI 或素材。所参考官方包、版本、许可及验证范围见 [U3 证据](spikes/U3-dsh-settings.md)。独立悬浮窗保留后续任务；不扩展为桌宠。该决定增加主界面入口，不改变 Provider/Playback/Core 边界，也不表示平台音乐已经可用。
