# 交付与使用说明

更新：2026-11-04，发行基线为 **0.1.0**，首发范围为 Windows／网易云。包含陪伴界面、四个标签页、ASCII 频谱、持续补歌与播放延迟优化。macOS 适配随包提供，真机验收未完成；QQ 暂缓。版本范围与摘要见 [0.1.0 发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0.md)，完整产品验收及长期体验缺口仍在 [开发状态](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md) 保留。

## 支持范围

| 项目 | 当前范围 |
| --- | --- |
| 系统 | Windows，真实播放依赖 WPF `MediaPlayer` 与命名管道；macOS 实验性适配使用 AVFoundation、Unix socket 和 Keychain，现场音频/登录/退出仍未完成验收 |
| Node.js | `>=24.14.0 <25`；使用内置 `node:sqlite` |
| DSH | beta.3 在本机官方桌面 `0.2.0-rc.2` 验证过部分真实交互；当前源码在官方 `0.2.1-rc.5` 隔离 Web profile 补验后台、生命周期与防重复；其他版本需验证 |
| 网易云 | 扫码、账号校验、导入、点播与自主续播已有真实验证；会员、版权与资源限制由平台决定 |
| QQ 音乐 | 接入暂缓，保留适配代码和后续范围；当前无可用登录与播放链路 |
| UI | DSH 主内容区页面（从侧栏「肥鱼电台」进入）与 `shell.overlay` 悬浮条；当前源码含顶部四个标签页与背景频谱，设置只在主面板的「电台设置」标签页；不提供独立桌面窗口或托盘 |
| 模型 | 可选，复用 DSH 已配置的模型；歌单生成、总结和候选筛选共用预算与账本 |

## 安装

FeiyuFM 以 npm 包分发，通过 DSH 安装到当前 profile。在侧栏「插件 → 添加插件」的「包名或地址」中输入 `dsh-feiyufm@0.1.0`，安装完成后点击「立即启用」；跟随正式版更新用 `dsh-feiyufm@latest`。下载失败可切换「安装源 → npm 官方源」。DSH 会安装 bundle、读取 patch 并登记插件，无需手改 profile；单独 `npm install` 不会完成这一步。机制见 [DSH 官方安装说明](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)。

已安装 DSH CLI 的用户可通过 `dsh plugin --profile web add dsh-feiyufm@0.1.0 --registry https://registry.npmjs.org/` 安装到 Web profile；`web` 要对应实际启动的 profile，安装后重启该实例。桌面版使用上述应用内入口。

人工验收尚未发布的 P0 登录修复与 P1 首次引导时，在「包名或地址」输入 `https://github.com/A7m0spHere/dsh-feiyuFM`，从 `main` 安装；需要固定验收代码时可使用 `github:A7m0spHere/dsh-feiyuFM#<完整提交号>`。记录 profile 锁文件实际解析的提交号，不能只凭界面中的 `0.1.0` 判断是否加载修复。GitHub 源码安装会解析普通运行依赖；已发布的 npm `0.1.0` 不含这些后续改动。安装后从托盘完整退出并重开，按 [人工验收卡](spikes/P0-07-desktop-checklist.md) 验证，保留现有数据与凭据。

Windows 的隔离宿主验证使用 DSH `0.2.1-rc.5`；桌面宿主自带兼容 Node 24 时无需单独安装 Node。macOS 实验性适配要求 Xcode Command Line Tools 提供 `/usr/bin/swiftc`，首次启动原生后端时会编译 Helper 到 DSH 私有数据目录。这不代表 macOS 真机验收完成。

在 macOS 桌面 profile 中从源码接入：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-feiyuFM
```

将 `desktop` 和仓库绝对路径替换为本机实际 profile 与工作目录。安装后需从托盘完整退出并重启 DSH，后端改动才会载入。

打开侧栏「肥鱼电台」，在音乐平台卡片扫码、手机确认，再导入歌曲；当前源码的登录入口在「电台设置」标签页。模型是可选功能，使用用户自己的 DSH 配置；没有模型可点播输入歌曲。

已有 workspace 安装请经插件管理器更换来源，不在同一 profile 同时启用两份 FeiyuFM。仓库开发步骤在 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。npm 发行包包含运行依赖树、源码与各自许可，安装不需重新解析这些依赖。

从旧测试包 `dsh-feiyufm-core` 升级时，先在插件管理器移除旧来源，再添加 `dsh-feiyufm@0.1.0`。内部 RPC 标识和 `$DSH_HOME/fishfm/` 数据目录保持兼容，已有曲库、偏好与凭据引用继续使用；不要同时启用两个包来源。

## 首次听歌

beta.2 起的角色图下有一枚无文字的小开关，默认位于左侧，可以自行尝试另一侧。素材随包提供，无需 Wallpaper Engine 或手动提取；beta.1 尚无此功能。同源窗口即时同步、高窄面板适配已在 U13 隔离验证，真实生产窗口组合仍待验。

导入后，可直接点播输入曲库中的歌曲。自主听歌与电脑声音是独立开关：静听保留自主听歌但关闭声音，暂停冻结进度且不会被自动事件撤销。「今天停止」还会禁止当日自主行为，可通过「恢复自主听歌」解除。

电台按“参考歌曲 → 网易云推荐 → 模型挑歌”工作。导入后使用 DSH 已配置模型按批筛选，自动播放只来自入选池，失败保留同账号有效旧歌单；输入曲库中的歌曲可由用户明确点播。模型选择与用量位于“电台设置”。

顶部提供正在听／发现记录／偏好与反馈／电台设置四个标签页，DSH 全局设置没有重复入口。大肥鱼与当前歌曲并列，下方是整个可选池，播放控制在面板底部常驻；余量不足时后台按预算自动补充，也可手动“补充歌单”。

主面板（含电台设置标签页）与悬浮条共用 Core。隐藏悬浮条或切换页面继续播放，停用插件会停止其后台服务与播放。模型总结、歌单与候选筛选是低频调用，受开关、每日次数和共享 token 预算约束；逐曲播放不请求模型。beta.3 的 U18 取消手动找歌/换批的 15 分钟模型等待，后台自动筛选仍受冷却限制；并发、次数、预算、平台刷新节流和候选缓存保留。历史 npm beta.2 保持原规则。

当前源码进一步取消筛选的固定每日次数与成功冷却，按整个入选池的余量持续补歌（窗口外可播余量 12 首时补充、24 首停止），并把最近 50 次实际开始的歌曲设为自动续播、普通下一首和推荐队列的硬性防重复窗口；初始日预算为 100000 tokens。

## 更新

DSH `0.2.0-rc.2` 的插件页暂不支持自动更新。先在插件管理器卸载 FeiyuFM，再添加新版固定版本或 `dsh-feiyufm@beta`，安装完成后点击「立即启用」。必要时正常退出 DSH（含托盘）再启动；卸载或重启期间音乐会中断。

数据库与凭据位于 DSH 数据目录，不在 npm 包目录。不要手动删除数据库来完成升级；使用同一 profile 保留原数据，升级后核对歌曲、偏好与暂停状态。

## 数据与凭据

| 内容 | 位置与处理 |
| --- | --- |
| SQLite | `$DSH_HOME/fishfm/music.sqlite`，本机通常为 `~/.dsh/fishfm/music.sqlite`；调试入口可用 `--db` 指定 |
| 账号会话 | Windows：数据目录内 `credentials/*.dpapi`，使用 DPAPI CurrentUser 加密；macOS 源码版：用户 Keychain generic-password 项；SQLite 只存引用 |
| 本地记录 | 输入音乐、偏好、反馈、收听历史、成长、约束与模型 token 账本 |
| 模型事实包 | 有界的歌名、艺人、反馈、关系等；歌单生成不发平台 ID，候选筛选含曲目键；不发 Cookie 或凭据 |

凭据绑定当前 Windows 用户或 macOS 登录 Keychain，不随 Git 同步，也不能依靠复制密文跨设备登录。登出始终停用内存会话；只有持久化凭据删除成功后才提示已删除。删除失败时显示清理未完成，保留停用的引用并提供“重试清理凭据”，重启不会复用残留凭据。偏好重置与输入曲库清空是两个可恢复入口，不用于登出；删除数据库是完整清除本地数据，请先确认是否需要备份。

仓库不保存 Cookie、运行数据库或音频。测试 WAV 由脚本现场生成。

## 常见问题

- **已保存会话却不能导入：** 会话可能过期，查看错误阶段并重新登录；加密文件存在不代表账号有效。
- **有歌名却不能播放：** 歌名来自网易云候选，但播放仍可能受会员、版权或地址失效限制；以实际错误为准。
- **没有声音：** 先查看声音开关、静听模式和暂停状态，再检查系统音量及输出设备。日常 / 专注模式会恢复声音。
- **网易云连接一直“读取中”或提示运行依赖缺失：** 0.1.0 的 GitHub 源码安装可能缺少网易云运行依赖。通过 DSH 插件管理器将同一 profile 的来源更换为 npm `dsh-feiyufm@0.1.0`，确保只启用一份，再从托盘完整退出并重开 DSH；保留 `$DSH_HOME/fishfm` 下的数据与凭据，不要清库。修复版会显示读取失败及重试入口；已发布 0.1.0 尚不包含该提示修复。
- **没有候选：** 检查输入曲库、歌单核对结果与探索池状态，必要时补充歌单或点播曲库歌曲；当前源码在最近 50 次窗口内没有窗口外可播歌曲时会等待补批。
- **不能补充歌单：** 当前任务、预算或平台节流可能限制请求；余量不足时后台也会自动补充，等待期间仍可点播、暂停或换曲。
- **源码改动没有生效：** UI 修改后运行 `npm run build:client` 或 `npm run build`，再刷新界面。官方桌面版会缓存后端模块；后端或资源路由更新需从托盘完整退出 DSH 再启动，只关窗口、刷新页面或停用再启用插件不足以清除缓存。已发布 npm 安装不会自动取得尚未发布的源码改动。
- **悬浮条显示错误：** 可从抽屉内重试或重新核对；只有 Core 不可达才标为断连。

## 验证与边界

最新补验：[N26](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N26-hard-repeat-window.md) 在官方 DSH `0.2.1-rc.5` 隔离 Web profile 验证后台、生命周期、重启保持与最近 50 次硬窗口；[N27](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N27-continuous-recommendation-supply.md) 验证整个池持续补歌、预算与逐曲零模型请求；[U24](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/U24-companion-player.md) 在浏览器模拟验证陪伴界面与设置标签页。更早的真实平台候选经模型选出歌曲、入选曲的 WPF 静音进度与日常原生 Desktop 正常退出重开见 [N23](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N23-model-route-completion.md)；输出耗尽和只有推理无答案分别提示，默认额度仍为 256，可在推荐设置调到 4096，仍受共享日预算限制。前轮 Windows 实包、DPAPI、真人扫码、导入／听音／控制与停用证据在 [beta.3 验收](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3-acceptance.md)。最新测试计数与最终包状态只在开发路线维护；首包和 U12 历史 tarball 不能代替本轮安装包。

默认关闭额外媒体预热持有者，避免与实际歌曲打开竞争。可用 `FISHFM_PLAYBACK_WARM_HOLDERS=0..8` 指定固定数量，0 关闭；播放地址预取和下一首媒体预加载仍按各自规则运行，实际延迟受平台和系统环境影响。

macOS 真机、完整窗口组合、DSH 请求／上下文对照、多会话和筛选质量仍待验证。两小时连续观察已由用户 2026-10-16 取消作为阻塞门槛；用户 2026-10-30 完成的 Windows DSH Desktop 两小时播放反馈见 [用户反馈报告](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/R2-two-hour-playback-20261030.md)，当时存在 10 首以内重复，后续已按最近 50 次硬窗口修复并做离线与隔离验证，日常真实平台效果仍未验；逐曲零模型请求及 DSH 对照要求保留。当前状态统一见开发状态，短跑按 [N7](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N7-short-run.md) 的日期和范围阅读；模拟预览和引用审计不能替代真实验收。

## 许可

软件、平台音乐、角色图像与依赖的版权范围、署名、使用条件及 LGPL 库替换说明统一见 [版权声明](../THIRD_PARTY_NOTICES.md)。
