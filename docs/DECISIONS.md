# 决策、来源与参考线索

更新：2026-09-27。

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
| D04 桌宠选择 | 大肥鱼只是参考之一；自主悬浮窗可隐藏和启用 | 用户明确大肥鱼非必须；最终方案采用 Tauri 2 方向 |
| D05 独立偏好 | 用户环境与 Agent Taste 分离；Global/Session 分层 | 最终 MVP；具体参数待实现验证 |
| D06 零新增请求 | 日常音乐行为两小时新增 LLM 请求为 0，禁用主动反思 | 最终 MVP 硬验收；不沿用早期“初始化可调用一次”建议 |
| D07 探索 | 默认开启、20%、用户可设 0%～100% | 用户要求可调；20% 来自最终 MVP 默认值 |
| D08 默认角色 | v0.1 包含一个默认角色，格式兼容可后续扩展 | 最终 MVP 第 18 节；纠正旧本地稿将角色整体列为非必需的偏差 |
| D09 UI 生命周期 | 隐藏、关闭或崩溃 UI 后音乐核心继续 | 最终 MVP；继续播放所需宿主方式待验证 |
| D10 项目名称 | 肥鱼电台 FishFM；仓库 `dsh-feiyuFM`；DeepSeek Music Persona 保留为定位描述 | 2026-09-27 按用户要求命名并创建公开仓库；SeekFM 为历史用名，npm 发布与许可证另行确定 |

## 3. 本次补充的工程约定

以下是为了让需求可实现、可验收而增加的设计约定，**不是用户在原对话中逐项确认的事实**。保持产品范围不变，可随技术验证调整并记录理由。

- 拆分 Provider / Playback / Core：解决平台接入、音频输出和选歌队列混在同一接口的问题。
- 明确两个开关四种组合、暂停保持、Off 行为与临时约束期限：防止自动事件覆盖用户控制。详细规则只维护在 [MVP 第 3 节](MVP.md)。
- 用户点歌遇到已有禁播约束时需要明确例外；不得悄悄覆盖用户限制。
- 静音经历与可听播放分别记录；停止、失败或重启不凭空累加偏好。
- 单一队列、多 Session 状态隔离、命令去重与决策版本：避免抢播和迟到请求覆盖用户命令。
- 导入默认请求 300 首；不足如实展示；未知元数据不编造。
- 当前 Windows 环境优先验证；Tauri 2 为候选方向，其他系统没有已验证支持承诺。
- 零新增 LLM 请求和零 token 并非同一指标：静态工具描述是否消耗上下文需单独记录。

## 4. 参考项目清单（全部待核实）

这里保存原对话提到的名称和调研目的，不声明当前可用性。带 owner 的 GitHub 地址仅由对话标识推得，尚未打开验证；无 owner 的名称不猜测仓库地址。

| 对话线索 | 调研目的 | 使用前需要核实 |
|---|---|---|
| `dsh-netease-music` | 平台登录、Cookie、推荐、种子与解析流程 | 仓库归属、当前接口、依赖版本、代码许可 |
| `@dsh-external/dsh-music` | QQ 登录、搜索、歌单、vkey | 包与源代码对应关系、权限限制、维护状态、许可 |
| `NeteaseCloudMusicApi` / QQMusic API 项目 | 平台接口线索 | 当前维护源、版本、账号能力与失败路径 |
| [FuqiangCraft/dsh-desktop](https://github.com/FuqiangCraft/dsh-desktop) | DSH 与原生桌面边界 | 实际协议、进程生命周期、可复用代码范围 |
| [YijiaDuan/desktop-pet](https://github.com/YijiaDuan/desktop-pet) | 小型透明窗、托盘、置顶 | 当前技术栈、Windows 实际表现；不照搬内存宣传值 |
| `dsh-pet-indesktop` | 透明区域命中、隐藏停解码、DPI | 确切仓库、实现与可复用性 |
| [sereinmono/dsh-desktop-pet](https://github.com/sereinmono/dsh-desktop-pet) | DSH 事件驱动角色状态 | 实际事件接口、资源发现与许可证 |
| [ysyyhhh/dsh-pet](https://github.com/ysyyhhh/dsh-pet) | sprite sheet、角色包兼容 | 具体格式版本、素材许可与适配成本 |
| [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) | 宿主/桌面进程协议、交互 | 当前代码与素材的分别许可；不假定 legacy 素材可复用 |
| `AI-Desktop-Pet` | 原生窗口与动画组织经验 | 确切仓库与版本；不引入其聊天、视觉等扩展范围 |
| `Claudio FM` / `Decky Music` | 双平台候选池、探索率、统一适配思路 | 仓库归属与许可，未确认许可前只作设计研究 |

调研优先顺序：真实 DSH 宿主 → 两个平台 → 独立播放 → 桌面实现 → 可选角色包兼容。不能因为参考项目功能丰富而扩大 MVP。

## 5. 本次文件整理

原来的单份长规划拆为产品规格、架构、Phase 0 清单和本文件；`PROJECT_PLAN.md` 保留为路线入口，README 提供导航。新增项目级 `AGENTS.md` 指向这些事实来源，避免后续 Agent 重复恢复旧建议。

保留现有 `.gitignore`。没有创建空 `packages/`、下载参考仓库、生成素材、安装依赖、选择项目开源许可证或宣称技术验证通过。

## 6. 公开仓库与跨设备协作

用户随后要求命名并创建公开仓库，用于跨设备开发。仓库地址为 [A7m0spHere/dsh-feiyuFM](https://github.com/A7m0spHere/dsh-feiyuFM)，默认分支 `main`；开发分支采用 `codex/` 前缀。项目名称沿用 DSH 社区常见的 `dsh-` 前缀，FishFM 将大肥鱼形象与音乐主题结合。

本次命名参考了 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) 和 [dsh-music-player](https://github.com/kendu76/dsh-music-player) 的公开仓库名称；不代表前述参考项目的功能、许可与性能验证已经完成。跨设备操作说明维护在根目录 README。

## 7. 开发路线细化

2026-09-27，按用户要求细化后续路线：Phase 1 先实现最小控制核心，Phase 2 提前接入真实 DSH 和网易云形成首条播放闭环，再完成 QQ；完整偏好成长与桌面体验放在 Phase 3。该调整只改变工程顺序，双平台、独立人格、默认角色和零新增 LLM 请求的 v0.1 范围不变。

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
| 插件启动独立 Node 进程应复用宿主自身的垫片（`process.execPath --expose-internals` + `ELECTRON_RUN_AS_NODE=1`） | `dsh-desktop-host` 启动包管理器时即如此 | 已实测 |
| 权威事件表是 `SessionEventMap`；内部目标事件中只有 `turn_end` 有同名真实事件 | `dsh-agent-preset-registry/lib/typert.host.js` | 已实测 |
| 命令入口为 `ctx.tools.register` 与 `ctx.commands.register`，两者都返回 disposer | `dsh-tools`、`dsh-commands` 的 `lib/types/*.d.ts` | 已实测 |
| desktop profile 由 Electron 应用独占，CLI 不能导出或安装；插件只能经应用内 Plugin Manager 安装，新 bundle 可经 HMR 生效、替换包需重启 | CLI 两次拒绝并保持文件哈希不变；官方 `cordis-plugin-development` 技能 | 已实测 |
| `tool-plugin-manager` 行默认 `disabled: true`，故 Agent 默认没有 `plugin_manager` 工具 | `dsh-base/cordis.patch.yml` | 已实测 |

本轮尝试过手工向 `profiles/desktop/cordis.patch.yml` 插入插件行，运行中的应用未热加载；该文件已按备份逐字节还原。官方文档明确要求不要手写 profile 文件，因此不再把这条路径作为方案。真实 desktop profile 中的插件激活、真实事件观察与停用清理仍为未验证，需要用户经 Plugin Manager 安装探针 bundle 后复测。

本轮同时新增了可安装的探针 bundle（`spikes/P0-01-desktop-probe/`）与管道客户端样例，两者只用于验证，不是产品插件。
