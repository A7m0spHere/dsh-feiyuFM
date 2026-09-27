# P0-01 DSH 生命周期局部验证

- 日期 / 环境：2026-09-27，Windows，本机 DSH desktop 托管运行时 `0.1.7-rc.2`，隔离的临时 `DSH_HOME` 和自建 Web profile。
- 状态：进行中。隔离 Web profile 内的插件加载/热卸载、`session/event` 类型、工具入口、慢调用隔离以及 Core 子进程清理已验证；真实用户发起的命令、desktop profile 安装和更细的 Session 负载仍未验。
- 来源：本机 `C:\Users\86137\AppData\Roaming\dsh-desktop-mvp\managed-runtime\node_modules\.bin\dsh.CMD --version` 返回 `0.1.7-rc.2`；[官方插件教程](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)及[架构文档](https://deepseek-harness.github.io/deepseek-harness/en/reference/)说明 `apply`、`ctx.effect`、profile 和 patch 的用法。
- 实验：用 CLI 的 `--from-default-profile web` 在临时 `DSH_HOME` 创建 `fishfm-spike` profile；在 profile 的 `cordis.patch.yml` 插入[最小样例](../../spikes/P0-01-lifecycle.mjs)。样例监听 `session/event`，建立一个隔离 Session 并追加 `turn/start`，注册并内部调用 `fishfm_probe` 工具；工具延迟后通过 JSON 行向独立 Node Core 子进程发送 `pause`。在工具尚未结束时请求本地 Web 端口，完成后把 profile patch 改回 `[]` 热卸载。

本机复现命令（PowerShell；`$dsh` 指向已安装的 CLI，不进入 desktop profile）：

```powershell
$dsh = 'C:\Users\86137\AppData\Roaming\dsh-desktop-mvp\managed-runtime\node_modules\.bin\dsh.CMD'
$env:DSH_HOME = Join-Path $env:TEMP 'fishfm-p0-01'
New-Item -ItemType Directory -Path $env:DSH_HOME -Force | Out-Null
$plugin = (Resolve-Path 'spikes/P0-01-lifecycle.mjs').Path.Replace('\', '/')
& $dsh fishfm-spike --from-default-profile web --dump-config | Out-Null
$patch = Join-Path $env:DSH_HOME 'profiles/fishfm-spike/cordis.patch.yml'
"- insert:`n    - id: fishfm-p0`n      name: '$plugin'" | Set-Content -LiteralPath $patch
& $dsh fishfm-spike --no-open
```

另一终端在运行时把 `$patch` 内容改为 `[]`，确认 `FISHFM_P0_DISPOSE` 和 `FISHFM_P0_CHILD_EXIT:0`，且 Web 端口继续响应；最后 Ctrl+C 退出并清理自己创建的临时 `DSH_HOME`。Web 端口可能由其他服务占用，复现前需确认端口。可把环境变量 `FISHFM_P0_DELAY_MS` 设为 `20000`，在 `FISHFM_P0_TOOL_START` 和 `FISHFM_P0_TOOL_END` 之间发请求。

- 观察：插件记录 `FISHFM_P0_APPLY`，以及 `permission/preset`、`sandbox/mode`、`approval/policy`、`turn/start` 等实际事件类型；本机类型声明确认 `session/event` 回调签名为 `(session, event)`。工具执行记录 `FISHFM_P0_TOOL_RESULT:ok`，表示 Core 子进程返回暂停快照。20 秒工具调用尚未结束时，Web 端口返回 HTTP 401（服务仍响应并要求认证）。热卸载时子进程退出码 0，进程已消失，Web 仍返回 401。没有向真实 desktop profile 安装样例；临时访问 token 未入库。
- 结论：本机 DSH `0.1.7-rc.2` 的 Web profile 能用 `ctx.tools.register` 进入命令执行，`ctx.on('session/event')` 观察事件，并由 `ctx.effect` 管理独立 Core 子进程生命周期。自调用工具不等于用户在真实对话中点歌；本实验也未验证平台资源、桌面安装或完整事件映射。
- 影响：F1 的 DSH 版本、基本命令/事件入口和 Core 子进程宿主有局部实测依据；desktop 接入、生产 IPC 与 P0-01 完成条件仍未通过。

## F1 桌面宿主补充核对（2026-09-27）

上一轮只知道 Web profile。本轮针对 F1 未闭环的「desktop 宿主与工具链结论」做只读核对，证据来自运行中进程的命令行、安装内代码、以及通过 DSH 自带 node 垫片读取 `app.asar` 的实测输出。**没有把样例安装进真实 desktop profile 后就宣布通过。**

- 执行环境：Windows，CUI 版本 `0.1.7-rc.2`（`@deepseek-ai/dsh-desktop-runtime` 与 `dsh-session`/`dsh-tools`/`dsh-credentials` 等同为 `0.1.7-rc.2`），Electron `44.0.0`。
- 宿主进程模型（实测命令行）：`"D:\dsh\DeepSeek Harness.exe" --expose-internals D:\dsh\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js D:\dsh\resources\app.asar\dsh C:\Users\86137\.dsh\profiles\desktop D:\dsh\resources\runtime\primary-runtime D:\dsh\resources\runtime\pnpm\bin\pnpm.mjs D:\dsh\resources\runtime\bin`。Electron 外壳负责并行启动 Host，Host 通过 `process.send` 汇报 `ready`/`fatal`/`platform-session` 并响应 `shutdown`、`quit-inspection`、`update-tasks`。Web 服务监听 `127.0.0.1:19387`（未认证请求返回 401），端口在 `dsh-desktop-host` 中写死为 `--port 19387`。
- 工具链（实测）：`resources/runtime/versions.json` 声明 node `24.18.1`、pnpm `11.7.0`；`primary-runtime/runtime.json` 声明 desktopVersion `0.1.7-rc.2`、node `24.21.0`、python `3.12.14`。以 `ELECTRON_RUN_AS_NODE=1` 运行 `resources/runtime/bin/node.cmd` 得到 node `24.18.1`、`require('node:sqlite')` 可建表写入读回（`available value=ok`），`process.execPath` 为 Electron 可执行文件。**结论：Core 的 `node:sqlite` 存储方案在桌面宿主自带运行时可用，不需要额外安装 Node。**
- 子进程约定（实测 + 安装内代码一致）：`dsh-desktop-host` 自己就是这样启动包管理器的——`process.execPath --expose-internals <pnpm.mjs>`，环境带 `ELECTRON_RUN_AS_NODE=1`、`DSH_DESKTOP_NODE_EXECUTABLE=process.execPath`，并把 `resources/runtime/bin` 前置到 `PATH`。可用环境变量实测存在：`DSH_HOME`、`DSH_PROFILE=desktop`、`DSH_PROFILE_DIR`、`DSH_SESSION_ID`、`DSH_SHELL`、`DSH_WEB_URL`、`DSH_DESKTOP_NODE_EXECUTABLE`。**结论：插件用同一套垫片启动独立 Node 进程（Core、将来的 Playback 宿主）是宿主自身的既定做法，不是猜测。**
- 事件映射（安装内类型声明实测）：`@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js` 的 `SessionEventMap` 是权威事件表，包含 `turn/start`、`turn/end {turn, reason}`、`step/start`、`step/end`、`user/message`、`assistant/message`、`tool/call {turn, step, callId, name, arguments}`、`tool/result {..., error?, meta?}`、`request/header`、`sandbox/mode`、`approval/asked`、`approval/decided`、`approval/policy`、`permission/preset`、`command/run`、`command/done`、`agent-preset/selected`、`session/title`、`todo/write`、`model/selection`、`compaction/*` 等。**内部目标事件里只有 `turn_end` 有真实对应（`turn/end`）；`session_start`、`task_phase_change`、`idle` 没有同名真实事件，必须由 `turn/start`、工具调用与本地计时推导，或保持 `unknown`。** 这与架构第 4 节「文档中的事件名称都是内部目标语义」一致。
- 命令入口（安装内 `.d.ts` 实测）：工具是 `ctx.tools.register(definition) → disposer`，`ToolDefinition` 必带 `output: { schema, render }`，可选 `timeoutMs`、`projectContent`、`finalizeContent`，`execute(args, exec)` 须观察 `exec.signal`；斜杠命令是 `ctx.commands.register(definition) → disposer`，`CommandDefinition` 为 `{ name（小写无斜杠）, description, handler(invocation), input?, recordInput? }`，执行前后由宿主写入 `command/run`、`command/done`。**结论：用户命令有工具和斜杠命令两个正式入口，UI 设置与 DSH 命令将来都投递到 Core 的同一命令入口。**
- 插件安装路径（文档 + 安装内 patch 实测）：官方技能 `cordis-plugin-development` 要求以工作区 bundle（`package.json` 声明 `dsh.bundle.patch`）交付，再由 `plugin_manager` 工具的 `install_bundle` 安装，并明确禁止手写 profile 的 `package.json`／`cordis.patch.yml`。`dsh-base/cordis.patch.yml` 中 `tool-plugin-manager` 行默认 `disabled: true`（因此本 Agent 默认没有该工具），`plugin-manager` 与 `hmr` 行在 `!!js "!ctx.get('profileContext')"` 为假时启用。
- desktop profile 由应用独占（实测）：`dsh --profile desktop --dump-config` 与 `dsh plugin --profile desktop add <包名>` 都返回 `error: profile "desktop" is managed exclusively by the Electron application`；`--from-default-profile` 只接受 `acp`、`headless`、`sdk`、`sdk-minimal`、`web`，没有 `desktop` 模板。两次尝试前后 profile 目录四个文件哈希完全不变。**结论：CLI 无法创建、导出或安装 desktop profile，桌面插件只能经应用内的 Plugin Manager 安装；新 bundle 可经 HMR 生效，替换已安装包需要重启。**
- 本轮尝试过但**未成功**的路径：手工向 `profiles/desktop/cordis.patch.yml` 追加 `- insert:` 行后，运行中的应用没有热加载该行（截至等待 6 秒无任何插件输出，Web 端口仍正常返回 401）；随后已按备份逐字节还原该文件（`sha256 236CABB2…4F8E3A`，还原后哈希与原文一致）。这与官方「不要手写 profile patch」的要求一致，不再重复该路径。
- 仍未验证：样例 bundle 在真实 desktop profile 中被激活并观察到真实事件、`ctx.commands` 是否可用、以及停用后子进程退出。需要用户在本机 DSH 的 Plugin Manager 中安装 `spikes/P0-01-desktop-probe/`（或在设置中启用 `tool-plugin-manager` 行后由 Agent 调用 `install_bundle`）才能闭环；这两条都没有代替「已通过」。
- 影响：F1 的宿主、运行时、子进程约定、事件入口与安装路径已有实测依据；desktop 实时激活与 P0-01 完成条件仍保持未通过。
