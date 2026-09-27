# P0-04 独立播放宿主基础验证

- 日期 / 环境：2026-09-27，Windows，本机 PowerShell 7 STA、WPF `System.Windows.Media.MediaPlayer`。
- 状态：进行中。自生成 WAV 的真实播放、暂停、静音、恢复、曲终事件、父进程退出后的存活，以及命名管道控制端断开/重连已验证；平台资源与实际桌面 UI 退出仍未测。
- 来源：[Microsoft MediaPlayer 文档](https://learn.microsoft.com/en-us/dotnet/api/system.windows.media.mediaplayer?view=windowsdesktop-10.0)、[MediaEnded 事件](https://learn.microsoft.com/en-us/dotnet/api/system.windows.media.mediaplayer.mediaended?view=windowsdesktop-10.0)、[PipeOptions.CurrentUserOnly](https://learn.microsoft.com/dotnet/api/system.io.pipes.pipeoptions)。本项目的[直接播放探针](../../spikes/P0-04-wpf-playback.ps1)、[管道宿主](../../spikes/P0-04-pipe-host.ps1)与[Node 客户端](../../spikes/P0-04-pipe-client.mjs)只调用系统组件，不复用第三方代码；测试音频由本机 FFmpeg sine 滤镜生成，音频文件不入库，FFmpeg 不作为当前产品依赖。
- 输入：`ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=10' -c:a pcm_s16le -ar 44100 -ac 1 -y <临时目录>/fishfm-tone.wav`，生成 10 秒短音频。
- 直接运行：`pwsh -Sta -NoProfile -File spikes/P0-04-wpf-playback.ps1 -AudioPath <临时音频路径>`。另用 `Start-Process` 以 `-WindowStyle Hidden`、`-RedirectStandardOutput` 和 `-PassThru` 启动同一脚本；父 PowerShell 命令立即返回，在另一命令中检查子进程及输出。
- 观察：`OPENED=True`、`FAILED=False`；播放位置约 1.04 秒，暂停前后约 1.06→1.07 秒（两秒等待），恢复后约 2.11 秒；静音值从 True 恢复 False；`ENDED=True` 且位置 10 秒。隐藏子进程在启动命令返回后仍存活，输出 `ENDED=True` 后自行退出，错误输出为空。
- 管道实验：用 `Start-Process -WindowStyle Hidden` 启动 `pwsh -Sta -NoProfile -File spikes/P0-04-pipe-host.ps1 -PipeName fishfm-p0-20260927-b`，父命令返回后由 `node spikes/P0-04-pipe-client.mjs fishfm-p0-20260927-b <JSON 命令>...` 分三次连接。第一次 `load`/`play` 后退出；第二次重连读取约 10.5 秒进度，`pause` 后等待 1.2 秒仍约 10.5 秒，`mute:true`、`play` 后位置继续增长；第三次重连读取约 24 秒进度、解除静音，并收到 `ended` 事件和 25 秒 `ended` 快照。第四次重连仍读到 `ended`，发送 `exit` 后宿主进程退出。错误输出为空。

最小重连复现（PowerShell，在项目根目录；每次 `node` 是独立客户端进程）：

```powershell
New-Item -ItemType Directory -Path '.tmp' -Force | Out-Null
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=25' -c:a pcm_s16le -ar 44100 -ac 1 -y '.tmp/fishfm-tone.wav'
$pipe = 'fishfm-p0-repro'
$script = (Resolve-Path 'spikes/P0-04-pipe-host.ps1').Path
$args = "-Sta -NoProfile -File `"$script`" -PipeName $pipe"
$hostProcess = Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput '.tmp/pipe.out' -RedirectStandardError '.tmp/pipe.err' -PassThru
$load = @{type='load'; path=(Resolve-Path '.tmp/fishfm-tone.wav').Path} | ConvertTo-Json -Compress
node spikes/P0-04-pipe-client.mjs $pipe $load '{"type":"play"}'
node spikes/P0-04-pipe-client.mjs $pipe '{"type":"snapshot"}' '{"type":"pause"}' '{"type":"mute","value":true}' '{"type":"play"}'
node spikes/P0-04-pipe-client.mjs $pipe '{"type":"snapshot"}' '{"type":"exit"}'
```

记录 `$hostProcess.Id` 可确认首个客户端退出后宿主仍在、`exit` 后已退出；复现完删除自己创建的临时文件。
- 静音整曲实验：连接新宿主后先发送 `mute:true`，再 `load`/`play` 4 秒自生成 WAV；期间不解除静音，收到 `ended`，快照为 `positionMs:4000`、`muted:true`。因此本机可采用**真实播放器静音并继续音频时间线**作为 Silent 进度方案，不需要为这一路径虚构逻辑时钟。
- 进程与协议观察：管道服务用 `PipeOptions.CurrentUserOnly` 限制为同一 Windows 用户与权限级别；实际 Node 客户端连接成功。`MediaOpened` 可能晚于 `play`，不能让晚到的 opened 把 playing 状态覆盖；恢复播放后立即读 `Position` 偶尔短暂得到 0，约一秒后恢复实际位置，适配器不能用这一瞬时值重置 Core 进度。
- 失败输入：把非音频文本保存为 `.mp3` 后调用 `load`/`play`，约 1.5 秒时快照仍为 `playing`、0 ms；稍后重连快照变为 `error`、0 ms。`MediaFailed` 可观察，但打开过程有延迟；正式适配器必须等到 `MediaOpened` 或 `MediaFailed`，并给出有限超时，不能因调用 `Play()` 返回就宣布 `started`。
- 结论：WPF MediaPlayer 在本机能作为**无可见窗口的独立播放进程候选**，提供真实时间线、曲终事件和可重连的本地命名管道。当前样例用 WinForms 消息泵推进 WPF 事件；协议尚无 `commandId`、播放实例与版本守卫，也未验证平台资源、真实 UI 退出、服务崩溃恢复和实际账号音频，不能据此锁定生产后端。
