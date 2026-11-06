# #19：Windows WPF 公网音频打开失败

日期：2026-11-06。源码修复与验证边界见 [PROJECT_PLAN](../PROJECT_PLAN.md)，产品与接口分别见 [MVP](../MVP.md)、[CORE_CONTRACT](../CORE_CONTRACT.md)。本报告不代表旧 npm 0.1.1 已更新或日常 Desktop 已加载；后续已发布的修复版本见 [0.1.2发行确认](../releases/0.1.2.md)。

## 反馈与根因依据

[#19 最新回复](https://github.com/A7m0spHere/dsh-feiyuFM/issues/19#issuecomment-6673421109) 报告：所有歌曲失败；已保存消息为「对于媒体仅支持源站点包 URI。」；同机公开 HTTPS MP3 在 pwsh 7.6.9／.NET 10.0.14 中触发 MediaFailed，在 Windows PowerShell 5.1／Framework 4.8 中同步 Open 抛错；两者本地 WAV/MP3 均能打开。原故障进程的运行时版本没有持久化，不能把重现版本当作确证。

Microsoft [WPF OpenMedia 源码](https://github.com/dotnet/wpf/blob/main/src/Microsoft.DotNet.Wpf/src/PresentationCore/System/Windows/Media/MediaPlayerState.cs) 对 HTTP(S) 增加默认凭据区域策略门控；不允许时复用 pack URI 错误消息，在进入原生网络媒体层前返回。上游 [dotnet/wpf#11856](https://github.com/dotnet/wpf/issues/11856) 描述了对应回归。本次判断：用户 .NET 10 重现与该分支吻合；Framework 同步空引用的具体内部路径尚未在本机复验。两种宿主均改用其已能打开的本地文件路径，不依赖区域检查的逃生开关。

## 修改

- 当前实现由 Node Playback 服务的 `media-download.mjs` 承担匿名暂存，再由原 WPF 主循环执行本地 `Open()`；取代首轮 `666a183` 在宿主内动态编译 C# 下载器的方式。前台下载前停止旧源，下载期间控制命令独立服务；下载完成不代表播放成功，仍等待实际 MediaOpened／音频进度。
- 不使用系统默认凭据、Cookie 或代理认证；直接连接。手动最多 5 次 HTTP(S) 跳转，拒绝 URL 用户信息、其它协议和 HTTPS 降级。声明长度与实际流均限 64 MiB，空文件、截断及非 200 响应失败。下载和本地打开共用默认 12 秒截止。
- Playback 服务为当前与备用资源保留文件租约，预加载命中转移同一租约、不再次下载。WPF 交换后关闭退役本地源；取消、失败和替换时释放自身资源，文件被原生播放器占用时延后重试，正常退出先关闭播放器再清理。不进入仓库、数据库、UI、模型或日志；强杀可能留下系统临时文件。
- 下载错误为固定 `media_download_failed`，与本机 `media_failed` 分别提示；Core 沿用候选失败的有界回退及 5 分钟退避，失败不登记收听或成长。
- 引入既有取证分支的独立只读 `scripts/read-last-error.mjs` 与回归，补中文固定消息映射。只精确匹配白名单，带任意附加自由文本仍隐藏；运行时缺失继续输出 unknown。入口比较使用真实路径，兼容 macOS `/var` 符号链接。
- 三处既有证据测试将目录阻断 rename 的 Windows `EPERM` 与 macOS/Linux `EISDIR` 分别断言，保留失败次数、去重、恢复与清理的原要求。

## 验证方法

首轮 `666a183` 在 macOS、Node 24.16.0 验证。恢复 shrinkwrap 声明的既有依赖，没有新增生产依赖。临时下载 Microsoft 官方 PowerShell 7.6.9 macOS arm64 便携包，SHA-256 `a1c7e98ac403da4be5ba75c1c5855af272de7787a91d478c4267466fe58fc1af` 与发行摘要一致，仅用于解析生产 PS 脚本、编译当时的 C# 类型及运行合成测试，未安装到系统或切换产品宿主。

首轮的 `test/playback-download.test.mjs` 从生产 PS 脚本提取实际函数，使用播放器替身及本机 HTTP 服务验证下载与控制。续修后该文件直接测试实际 Node 暂存器及 Playback 集成：认证挑战不带凭据、Cookie 不回传、跳转／降级／非法协议、声明及分块超限、截断／空响应、头／体停滞、取消／关闭、迟到结果隔离、共用截止和文件租约转移。实际 WPF 的两种宿主预加载／暂停／恢复／交换／退出另由 `test/playback-wpf.test.mjs` 覆盖；没有音频环境的 CI 明示跳过真实解码。结果统一维护在 PROJECT_PLAN。

## Windows CI 补验

修复提交 `666a183` 的 [Windows CI](https://github.com/A7m0spHere/dsh-feiyuFM/actions/runs/42220544443) 全部成功：Windows Server 2025、Node 24.22.2；787 项中 782 通过、0 失败、5 项真实媒体跳过。实际生产下载类型／命令函数的匿名下载、失败、取消、预加载交换和清理测试在已安装的 pwsh 与 Windows PowerShell 5.1 均通过；真实 WPF 的停滞打开／备用加载取消控制亦通过。195 模块检查、完整构建／debug smoke、125 文档零坏链、288 份依赖声明与 4898 文件实包白名单均通过。CI 没有音频设备验收，不代表反馈设备上的真实公开 HTTPS／平台歌曲已成功解码或发声。

## Windows 续修：移除宿主内动态编译下载器

本机 Windows 10.0.22631、Node 24.22.1 复核首轮代码时，下载测试两次在 Windows PowerShell 5.1 以 `4294967295` 退出，实际宿主也在握手前退出，随后源脚本从磁盘消失。后来只读查询火绒的行为日志与隔离记录，确认 `Trojan/PS.PsLoader.A` 规则处理了该宿主及测试脚本；隔离条目、文件SHA-1与测试进程相符。此前“触发方未知”的核查记录已由这条本机证据补足，不是将测试失败推断为网络问题。

续修将下载职责放回 Node Playback 服务，使用内置 HTTP(S) 与明确的直接连接代理对象，不动态编译额外下载器，也不执行下载的内容，不增加依赖或子进程；WPF 仍使用原播放器和协议。没有恢复隔离区、添加排除项、混淆代码、关闭防护或改变系统策略。保持匿名、5次跳转、64MiB和12秒共享准备预算；暂停/版本更新取消Node请求，旧文件不能取代或清理新曲目。下载期间同版本的静音更新在本地打开时采用最新值，相关交错用例先失败后通过。

对同一公网 HTTPS MP3，以两个真实原生宿主分别验证新路径，音量0且muted=true，结果如下；没有使用平台账号或CDN URL：

| 宿主 | 实际打开／时长 | 真实started／progress | 正常退出／暂存清理 |
|---|---|---|---|
| 系统Windows PowerShell 5.1／Framework 4.8.1 | 成功，5068ms | 成功，首次记录422ms | 均通过 |
| 官方便携pwsh7.6.5／.NET10.0.11 | 成功，5068ms | 成功，首次记录405ms | 均通过 |

证据见 [Windows续修结果](assets/ISSUE-19-windows-node-staging.json)。所用便携运行时SHA-256为 `32eb8f6cdce08f86e987d625a2733e54ac3e289ae7e1621b14c0b5bcec2434ea`，沿用此前已与官方摘要核对的MIT包，未安装或降级系统运行时。验证后宿主文件仍存在，相关火绒匹配记录的数量与最后时间均未新增；这只说明本次实测结果，不承诺所有防护产品或系统环境。

另以生成的本地HTTP WAV在已安装pwsh和5.1中实际验证暂停冻结进度、备用文件在暂停后释放、恢复、预加载交换不重下载、退役文件释放、停止和退出清理；既有 WPF 停滞控制、歌词seek及管道回归保留。以上是隔离、静音、真实解码与时间线证据，不替代实际听音、用户账号或日常Desktop加载。

## 剩余边界

- 首轮macOS/CI替身与续修Windows静音真解码分别记录。仍需在反馈设备以修复后的完整插件验证真实平台歌曲、听音和日常加载；原故障实例版本未持久化，不把本机通过提升为用户实机验收。
- 完整下载增加冷打开等待与临时磁盘写入；大于 64 MiB、超过共用截止或只能通过代理连接的资源会失败。没有以测试证明新延迟优于旧版本；未来优化须保留匿名与取消边界。
- 原 issue 的初始化 `cancelled` 高频日志没有新的复现材料，本轮未将其归因于媒体策略，也未声称修复该独立现象。
- 未改系统区域设置、AppContext 安全开关、系统安全补丁或 PowerShell 选择顺序；未登录、调用真实模型、主动重载日常 Desktop、发布 npm 或关闭 issue。

## 同步与本地备份

本次同步前本地 main 与远端已分叉，且有 U19 未提交修改与 ComfyUI 文件删除。完整旧历史保留于本地 `codex/pre-sync-20261106`（`cb29cca`），工作区和未跟踪文件保留于 stash `b6aff96c51545a7d793e1cf4995d2ae0eb53969e`，未丢弃或自动重放到新 main。随后从远端 `712eed5` 建立 main 并 `git pull --ff-only`。这两份备份仅在本机，不纳入远端修复提交。
