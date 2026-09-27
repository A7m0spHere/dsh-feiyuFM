# P0-01 DSH 生命周期局部验证

- 日期 / 环境：2026-09-27，Windows，本机 DSH desktop 托管运行时 `0.1.7-rc.2`，隔离的临时 `DSH_HOME` 和自建 Web profile。
- 状态：进行中。插件 `apply` 和 `ctx.effect` 的卸载回调已由真实 DSH 进程观察；真实 Session 事件字段、用户命令入口、慢请求隔离和 desktop profile 安装未验。
- 来源：本机 `C:\Users\86137\AppData\Roaming\dsh-desktop-mvp\managed-runtime\node_modules\.bin\dsh.CMD --version` 返回 `0.1.7-rc.2`；[官方插件教程](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)及[架构文档](https://deepseek-harness.github.io/deepseek-harness/en/reference/)说明 `apply`、`ctx.effect`、profile 和 patch 的用法。
- 实验：用 CLI 的 `--from-default-profile web` 在临时 `DSH_HOME` 创建 `fishfm-spike` profile；通过 `--patch` 插入 [最小样例](../../spikes/P0-01-lifecycle.mjs)，启动 `dsh fishfm-spike --patch <临时 patch> --no-open`；对本地 Web 端口发起未授权请求；Ctrl+C 正常退出。

本机复现命令（PowerShell；`$dsh` 指向已安装的 CLI，不进入 desktop profile）：

```powershell
$dsh = 'C:\Users\86137\AppData\Roaming\dsh-desktop-mvp\managed-runtime\node_modules\.bin\dsh.CMD'
$env:DSH_HOME = Join-Path $env:TEMP 'fishfm-p0-01'
New-Item -ItemType Directory -Path $env:DSH_HOME -Force | Out-Null
$plugin = (Resolve-Path 'spikes/P0-01-lifecycle.mjs').Path.Replace('\', '/')
$patch = Join-Path $env:DSH_HOME 'probe.patch.yml'
"- insert:`n    - id: fishfm-p0`n      name: '$plugin'" | Set-Content -LiteralPath $patch
& $dsh fishfm-spike --from-default-profile web --dump-config | Out-Null
& $dsh fishfm-spike --patch $patch --no-open
```

确认 `FISHFM_P0_APPLY` 后用 Ctrl+C 退出并确认 `FISHFM_P0_DISPOSE`；清理自己创建的临时 `DSH_HOME`。Web 端口可能由其他服务占用，复现前需确认端口。
- 观察：终端出现 `FISHFM_P0_APPLY`，Web 端口返回 HTTP 401（服务已响应并要求认证），退出时出现 `FISHFM_P0_DISPOSE`。没有向真实 desktop profile 安装样例。终端显示的临时访问 token 没有保存到仓库。
- 结论：本机可用的 DSH 插件生命周期至少支持 `apply` 与 `ctx.effect` 清理。不能从本实验推断 `session/event` 的真实负载、音乐命令接入方式，或独立 Core/Playback 的启停方案。
- 影响：F1 的 DSH 版本与基本生命周期有局部依据；F1 的宿主前置和 P0-01 退出条件仍未完成。
