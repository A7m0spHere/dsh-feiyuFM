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
