# #19：Windows WPF 公网音频打开失败

日期：2026-11-06。源码修复与验证边界见 [PROJECT_PLAN](../PROJECT_PLAN.md)，产品与接口分别见 [MVP](../MVP.md)、[CORE_CONTRACT](../CORE_CONTRACT.md)。本报告不代表 npm 0.1.1 已更新或日常 Desktop 已加载。

## 反馈与根因依据

[#19 最新回复](https://github.com/A7m0spHere/dsh-feiyuFM/issues/19#issuecomment-6673421109) 报告：所有歌曲失败；已保存消息为「对于媒体仅支持源站点包 URI。」；同机公开 HTTPS MP3 在 pwsh 7.6.9／.NET 10.0.14 中触发 MediaFailed，在 Windows PowerShell 5.1／Framework 4.8 中同步 Open 抛错；两者本地 WAV/MP3 均能打开。原故障进程的运行时版本没有持久化，不能把重现版本当作确证。

Microsoft [WPF OpenMedia 源码](https://github.com/dotnet/wpf/blob/main/src/Microsoft.DotNet.Wpf/src/PresentationCore/System/Windows/Media/MediaPlayerState.cs) 对 HTTP(S) 增加默认凭据区域策略门控；不允许时复用 pack URI 错误消息，在进入原生网络媒体层前返回。上游 [dotnet/wpf#11856](https://github.com/dotnet/wpf/issues/11856) 描述了对应回归。本次判断：用户 .NET 10 重现与该分支吻合；Framework 同步空引用的具体内部路径尚未在本机复验。两种宿主均改用其已能打开的本地文件路径，不依赖区域检查的逃生开关。

## 修改

- WPF 宿主内嵌 C# HttpClient 异步任务，匿名完整下载到随机临时文件，再由主循环执行本地 `Open()`。不让后台任务执行 PowerShell 回调；命令循环保持服务暂停、停止、下一首和预加载取消。下载开始前关闭旧源，下载完成不代表播放成功，仍等待实际 MediaOpened／音频进度。
- 不使用系统默认凭据、Cookie 或代理认证；直接连接。手动最多 5 次 HTTP(S) 跳转，拒绝 URL 用户信息、其它协议和 HTTPS 降级。声明长度与实际流均限 64 MiB，空文件、截断及非 200 响应失败。下载和本地打开共用默认 12 秒截止。
- 当前与备用播放器分别拥有文件；预加载命中时连同所有权交换，不再次下载。取消、失败和替换后取消任务并重试删除，正常退出关闭播放器后再清理。已完成文件只保留在活动／备用播放器生命周期内，不进入仓库、数据库、UI、模型或日志；强杀可能留下系统临时文件。
- 下载错误为固定 `media_download_failed`，与本机 `media_failed` 分别提示；Core 沿用候选失败的有界回退及 5 分钟退避，失败不登记收听或成长。
- 引入既有取证分支的独立只读 `scripts/read-last-error.mjs` 与回归，补中文固定消息映射。只精确匹配白名单，带任意附加自由文本仍隐藏；运行时缺失继续输出 unknown。入口比较使用真实路径，兼容 macOS `/var` 符号链接。
- 三处既有证据测试将目录阻断 rename 的 Windows `EPERM` 与 macOS/Linux `EISDIR` 分别断言，保留失败次数、去重、恢复与清理的原要求。

## 验证方法

本机 macOS，Node 24.16.0。恢复 shrinkwrap 声明的既有依赖，没有新增生产依赖。临时下载 Microsoft 官方 PowerShell 7.6.9 macOS arm64 便携包，SHA-256 `a1c7e98ac403da4be5ba75c1c5855af272de7787a91d478c4267466fe58fc1af` 与发行摘要一致，仅用于解析生产 PS 脚本、编译实际 C# 类型及运行合成测试，未安装到系统或切换产品宿主。

`test/playback-download.test.mjs` 从生产脚本提取实际函数，使用不解码、不发声的播放器替身及本机 HTTP 服务，验证完整下载、本地 URI、预加载交换、认证挑战不带凭据、Cookie 不回传、跳转环／非法协议、声明／分块超限、截断／空响应、体流停滞、暂停／取消／换曲与迟到打开标记、临时文件清理。Windows 上同一测试默认覆盖所有已安装的 pwsh／PowerShell 5.1；macOS 通过 `FISHFM_TEST_PWSH` 显式选择便携宿主。另有 Core 的下载失败不成长与候选退避回归、只读取证回归及 UI 错误分类回归。结果统一维护在 PROJECT_PLAN。

## 剩余边界

- 本轮本机没有 Windows WPF，替身不能证明解码或听音。需在反馈设备以修复后的完整插件验证公开 HTTPS 与真实平台歌曲、两种 PowerShell、本地媒体、暂停／下一首／预加载／正常退出；同时核对无凭据泄露及临时文件清理。
- 完整下载增加冷打开等待与临时磁盘写入；大于 64 MiB、超过共用截止或只能通过代理连接的资源会失败。没有以测试证明新延迟优于旧版本；未来优化须保留匿名与取消边界。
- 原 issue 的初始化 `cancelled` 高频日志没有新的复现材料，本轮未将其归因于媒体策略，也未声称修复该独立现象。
- 未改系统区域设置、AppContext 安全开关、系统安全补丁或 PowerShell 选择顺序；未登录、调用真实模型、主动重载日常 Desktop、发布 npm 或关闭 issue。

## 同步与本地备份

本次同步前本地 main 与远端已分叉，且有 U19 未提交修改与 ComfyUI 文件删除。完整旧历史保留于本地 `codex/pre-sync-20261106`（`cb29cca`），工作区和未跟踪文件保留于 stash `b6aff96c51545a7d793e1cf4995d2ae0eb53969e`，未丢弃或自动重放到新 main。随后从远端 `712eed5` 建立 main 并 `git pull --ff-only`。这两份备份仅在本机，不纳入远端修复提交。
