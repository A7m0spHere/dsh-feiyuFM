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
- Core 在宿主运行时上跑通（实测）：`primary-runtime/dependencies/node/bin/node.exe`（Node 24.21.0）与 `node.cmd`（Electron-as-node 24.18.1）分别执行 `scripts/check.mjs`、`node --test`、`scripts/build.mjs`，两者都是 8 个模块检查通过、14 项测试全过，payload Node 上 `build` 也成功（含用 `process.execPath` 启动子进程的调试冒烟）。此前这些命令只在机器自带的 Node 24.14.0 上跑过，现在**宿主自带运行时可用**，插件可以放心用 `process.execPath` 或垫片启动 Core。
- CI 在最新 Phase 1 提交上通过（实测）：`codex/phase1-core` 的 `f17a5da` 触发 `Core offline checks` 运行 `#36307587300`，运行页标题即该提交，页面含 `favicon-success` 与 4 处 “completed successfully”，无 failure/cancelled 标记。GitHub REST API 在本机被解析到非公网地址且未认证请求触发 403 限流，因此本项以运行页 HTML 为证据。
- `scripts/check.mjs` 改为递归遍历 `src`/`bin`/`scripts`/`test`（跳过 `node_modules`、`dist`、`.tmp`、`.git`），并实测验证：放入 `test/nested-probe/broken.mjs` 后 `npm run check` 以退出码 1 报 `SyntaxError`，删除后恢复 8 模块通过。此前只扫描顶层目录，Phase 2 新增的子目录会被静默跳过。
- 子进程约定（实测 + 安装内代码一致）：`dsh-desktop-host` 自己就是这样启动包管理器的——`process.execPath --expose-internals <pnpm.mjs>`，环境带 `ELECTRON_RUN_AS_NODE=1`、`DSH_DESKTOP_NODE_EXECUTABLE=process.execPath`，并把 `resources/runtime/bin` 前置到 `PATH`。可用环境变量实测存在：`DSH_HOME`、`DSH_PROFILE=desktop`、`DSH_PROFILE_DIR`、`DSH_SESSION_ID`、`DSH_SHELL`、`DSH_WEB_URL`、`DSH_DESKTOP_NODE_EXECUTABLE`。**结论：插件用同一套垫片启动独立 Node 进程（Core、将来的 Playback 宿主）是宿主自身的既定做法，不是猜测。**
- 事件映射（安装内类型声明实测）：`@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js` 的 `SessionEventMap` 是权威事件表，包含 `turn/start`、`turn/end {turn, reason}`、`step/start`、`step/end`、`user/message`、`assistant/message`、`tool/call {turn, step, callId, name, arguments}`、`tool/result {..., error?, meta?}`、`request/header`、`sandbox/mode`、`approval/asked`、`approval/decided`、`approval/policy`、`permission/preset`、`command/run`、`command/done`、`agent-preset/selected`、`session/title`、`todo/write`、`model/selection`、`compaction/*` 等。**内部目标事件里只有 `turn_end` 有真实对应（`turn/end`）；`session_start`、`task_phase_change`、`idle` 没有同名真实事件，必须由 `turn/start`、工具调用与本地计时推导，或保持 `unknown`。** 这与架构第 4 节「文档中的事件名称都是内部目标语义」一致。
- 命令入口（安装内 `.d.ts` 实测）：工具是 `ctx.tools.register(definition) → disposer`，`ToolDefinition` 必带 `output: { schema, render }`，可选 `timeoutMs`、`projectContent`、`finalizeContent`，`execute(args, exec)` 须观察 `exec.signal`；斜杠命令是 `ctx.commands.register(definition) → disposer`，`CommandDefinition` 为 `{ name（小写无斜杠）, description, handler(invocation), input?, recordInput? }`，执行前后由宿主写入 `command/run`、`command/done`。**结论：用户命令有工具和斜杠命令两个正式入口，UI 设置与 DSH 命令将来都投递到 Core 的同一命令入口。**
- 插件安装路径（文档 + 安装内 patch 实测）：官方技能 `cordis-plugin-development` 要求以工作区 bundle（`package.json` 声明 `dsh.bundle.patch`）交付，再由 `plugin_manager` 工具的 `install_bundle` 安装，并明确禁止手写 profile 的 `package.json`／`cordis.patch.yml`。`dsh-base/cordis.patch.yml` 中 `tool-plugin-manager` 行默认 `disabled: true`（因此本 Agent 默认没有该工具），`plugin-manager` 与 `hmr` 行在 `!!js "!ctx.get('profileContext')"` 为假时启用。
- desktop profile 由应用独占（实测）：`dsh --profile desktop --dump-config` 与 `dsh plugin --profile desktop add <包名>` 都返回 `error: profile "desktop" is managed exclusively by the Electron application`；`--from-default-profile` 只接受 `acp`、`headless`、`sdk`、`sdk-minimal`、`web`，没有 `desktop` 模板。两次尝试前后 profile 目录四个文件哈希完全不变。**结论：CLI 无法创建、导出或安装 desktop profile，桌面插件只能经应用内的 Plugin Manager 安装；新 bundle 可经 HMR 生效，替换已安装包需要重启。**
- 本轮尝试过但**未成功**的路径：手工向 `profiles/desktop/cordis.patch.yml` 追加 `- insert:` 行后，运行中的应用没有热加载该行（截至等待 6 秒无任何插件输出，Web 端口仍正常返回 401）；随后已按备份逐字节还原该文件（`sha256 236CABB2…4F8E3A`，还原后哈希与原文一致）。这与官方「不要手写 profile patch」的要求一致，不再重复该路径。
- 仍未验证：样例 bundle 在**真实 desktop profile** 中被激活并观察到真实事件。方向已定为经应用内 Plugin Manager 安装 `spikes/P0-01-desktop-probe/`（或在设置中启用 `tool-plugin-manager` 行后由 Agent 调用 `install_bundle`）；隔离 profile 宿主中的激活、注册、子进程与停用清理已经验（见下），但没有代替真实 desktop profile 的结论。
- 影响：F1 的宿主、运行时、子进程约定、事件入口与安装路径已有实测依据；desktop 实时激活与 P0-01 完成条件仍保持未通过。

### 探针 bundle 的隔离实跑与两条硬规则

为避免把未经运行验证的 bundle 交给用户安装，先在隔离 DSH_HOME 中实跑：`dsh f1probe --from-default-profile web --dump-config` 建 profile，`dsh plugin --profile f1probe add <绝对包目录>` 安装（该子命令需要 `pnpm` 在 PATH 上，应用自身是在 `resources/runtime/bin` 与 `pnpm-shim` 前置后运行 pnpm）。

- 安装结果（实测）：`+ @local/fishfm-p0-desktop-probe link:D:/AI项目/dsh-音乐/spikes/P0-01-desktop-probe`，并写入 profile 的 `dsh.profile.bundles`。**说明工作区 bundle 的清单与 patch 形式正确，用户经 Plugin Manager 安装不会因格式被拒。**
- 激活结果（干净一轮实测）：`apply` → `tool-registered ok` → `command-registered ok` → `pipe-server-listening` → `core-spawn` → `core-ready` → `pipe-server-data(22 bytes)` → `pipe-client-exit code 0 {"ok":true,"echo":"pong"}` → `tool-execute childPid=31240 alive=true` → `tool-self-call outcome=ok`，宿主保持监听。**插件能在宿主进程内注册工具与斜杠命令、自建命名管道并让子进程连上、通过 `ctx.tools.execute` 真实执行工具，且独立 Core 子进程存活可查。**
- 停用清理（关键实测）：在 profile 的 `cordis.patch.yml` 写入 `- id: fishfm-p0-desktop / disabled: true` 后热卸载，证据为 `dispose-begin` → `command-disposed` → `core-exit code 0` → `core-stopped graceful=true` → `dispose-end childAlive=false`，**同时宿主仍在 19401 监听**。再次改回 `[]` 后插件热重载，拿到新的子进程 pid（35144），管道往返与工具自调用再次成功。最后再停用一次确认 `fishfm-debug` 子进程数为 0（无残留）。**这就是「插件停用后停止其拥有的音乐服务、而宿主继续工作」的实测形态。**
- **硬规则一：未注入的服务属性访问会抛错。** 探针首版用 `ctx.commands` 读取服务，激活直接失败：`Error: cannot get property "commands" without inject`。官方实践文档要求把可选服务放进 `inject` 或 `ctx.inject([...], ...)`，否则插件应保持不激活而不是抛错。修正为 `ctx.inject(['commands'], …)` 并只用 `ctx.get('x')` 做存在性判断后激活成功。
- **硬规则二：工具 `output.schema` 不接受联合类型数组。** 首版用 `type: ['integer', 'null']`，被拒：`schema.properties.childPid.type must be a single type string (type arrays are not supported)`。每个属性只能给单个类型字符串。
- **事件信封是实观到的，不只是读类型（新证据）**：`ctx.on('session/event')` 回调拿到的不是扁平负载，信封固定为 `{type, seq: number, time, data}`，`SessionEventMap` 里的负载在 `event.data` 下。实观结果：`turn/start` → `data.turn=1`；`turn/end` → `data={reason, turn}`，`reason.kind='completed'`；`permission/preset` → `data.preset`；`sandbox/mode` → `data.mode`；`approval/policy` → `data.policy`。另外**创建 Session 本身会先发出 `permission/preset`、`sandbox/mode`、`approval/policy`**，可作为适配器识别「会话开始」的真实信号。`turn/end` 的 `reason` 是结构化对象（`TurnEndReasonMap`：`completed`/`aborted`/`blocked`/`error`/`max-tokens`/`interrupted`/`forked`），不是字符串。
- `ctx.sessions.create()` 与 `session.append(type, data)` 实观可用（`hasAppend=true`），回调签名为 `(session, event)`。
- 中途一次失败的原因已查明，属于**本轮测试装置的失误而非 profile 限制**：该轮一开始就 `listen EADDRINUSE: address already in use 127.0.0.1:19399`（上一轮遗留的宿主还占着端口），`webserver` 是必需插件，启动因此失败并连锁出 `webRuntime`、`connection`、`webServer` 等待服务的告警。先前的记录曾把原因写成「web 模板 profile 不完整」，**该说法是错的**：`web` 模板的 bundle 就是 `dsh-base` + `dsh-web-app`，与 desktop profile 只差一个可选 bundle。释放端口后同一 profile 完整跑通。
- 隔离测试的两点局限（如实记录）：一是本机 shell 继承了桌面宿主的 `DSH_*` 变量，隔离实例记录的 `DSH_PROFILE` 是继承值而非该 profile 名，不能当判据；二是该宿主是 CLI 启动的 web 组合（Node 24.14.0），不是 Electron 桌面宿主，`ctx.tools.execute` 的入参形式与 `credentials` 服务是否可用仍未在这些条件下核对（记录显示 `credentials=false`，因该 profile 未注入凭据服务）。
- 结论：bundle 格式、激活链路、工具/命令注册、命名管道往返、工具真实执行、独立子进程存活与**停用清理**都已在 profile 启动的宿主中实测通过；真实 Electron desktop profile 的激活与真实事件观察仍待用户经 Plugin Manager 安装后复测。
