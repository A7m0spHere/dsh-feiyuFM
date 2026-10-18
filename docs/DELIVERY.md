# 交付与使用说明

更新：2026-10-18，发行基线为 **0.1.0-beta.3** Windows／网易云测试版。macOS 适配随包提供，真机验收未完成，稳定 v0.1 也未完成验收。版本范围与摘要见 [beta.3 记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3.md)，源码／发布／日常加载及待验项只看 [开发状态](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

## 支持范围

| 项目 | 当前范围 |
| --- | --- |
| 系统 | Windows，真实播放依赖 WPF `MediaPlayer` 与命名管道；macOS 实验性适配使用 AVFoundation、Unix socket 和 Keychain，现场音频/登录/退出仍未完成验收 |
| Node.js | `>=24.14.0 <25`；使用内置 `node:sqlite` |
| DSH | 本机官方桌面 `0.2.0-rc.2` 已安装并验证部分真实交互；其他版本需验证 |
| 网易云 | 扫码、账号校验、导入、点播与自主续播已有真实验证；会员、版权与资源限制由平台决定 |
| QQ 音乐 | 接入暂缓，保留适配代码和后续范围；当前无可用登录与播放链路 |
| UI | DSH 侧栏主面板、设置页与 `shell.overlay`；不提供独立桌面窗口或托盘 |
| 模型 | 可选，复用 DSH 已配置的模型；歌单生成、总结和候选筛选共用预算与账本 |

## 安装

FishFM 以 npm 包分发，通过 DSH 安装到当前 profile。在侧栏「插件 → 添加插件」的「包名或地址」中输入 `dsh-feiyufm-core@0.1.0-beta.3`，安装完成后点击「立即启用」；跟随 beta 更新用 `dsh-feiyufm-core@beta`。下载失败可切换「安装源 → npm 官方源」。DSH 会安装 bundle、读取 patch 并登记插件，无需手改 profile；单独 `npm install` 不会完成这一步。机制见 [DSH 官方安装说明](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)。

已安装 DSH CLI 的用户可通过 `dsh plugin --profile web add dsh-feiyufm-core@0.1.0-beta.3 --registry https://registry.npmjs.org/` 安装到 Web profile；`web` 要对应实际启动的 profile，安装后重启该实例。桌面版使用上述应用内入口。

Windows Beta 的 DSH 本机验证版本为 `0.2.0-rc.2`；桌面宿主自带兼容 Node 24 时无需单独安装 Node。beta.3 包含 macOS 实验性适配，要求 Xcode Command Line Tools 提供 `/usr/bin/swiftc`；首次启动原生后端时会编译 Helper 到 DSH 私有数据目录。这不代表 macOS 真机验收完成。QQ 接入暂缓。

在 macOS 桌面 profile 中从源码接入：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-feiyuFM
```

将 `desktop` 和仓库绝对路径替换为本机实际 profile 与工作目录。安装后需从托盘完整退出并重启 DSH，后端改动才会载入。

打开侧栏「肥鱼电台」或设置中的同名页，在网易云卡片扫码、手机确认，再导入歌曲。模型是可选功能，使用用户自己的 DSH 配置；没有模型可点播输入歌曲。

已有 workspace 安装请经插件管理器更换来源，不在同一 profile 同时启用两份 FishFM。仓库开发步骤在 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。包包含运行依赖树、源码与各自许可，安装不需重新解析这些依赖。

## 首次听歌

beta.2 起的角色图下有一枚无文字的小开关，默认位于左侧，可以自行尝试另一侧。素材随包提供，无需 Wallpaper Engine 或手动提取；beta.1 尚无此功能。同源窗口即时同步、高窄面板适配已在 U13 隔离验证，真实生产窗口组合仍待验。

导入后，可直接点播输入曲库中的歌曲。自主听歌与电脑声音是独立开关：静听保留自主听歌但关闭声音，暂停冻结进度且不会被自动事件撤销。「今天停止」还会禁止当日自主行为，可通过「恢复自主听歌」解除。

beta.2 起按“参考歌曲 → 网易云推荐 → 模型挑歌”工作。导入后沿用 DSH 已配置模型按批筛选，主界面只显示歌单、理由和换一批；模型选择与用量放在折叠设置。自动播放只来自入选歌单，失败保留同账号有效旧歌单；用户下一首可回退参考曲库，自动续播不走这条回退。beta.1 仍保留当时的模型歌单/核对界面。

主面板、设置页与悬浮条共用 Core。隐藏悬浮条或切换页面继续播放，停用插件会停止其后台服务与播放。模型总结、歌单与候选筛选是低频调用，受开关、每日次数和共享 token 预算约束；逐曲播放不请求模型。beta.3 的 U18 取消手动找歌/换批的 15 分钟模型等待，后台自动筛选仍受冷却限制；并发、次数、预算、平台刷新节流和候选缓存保留。历史 npm beta.2 保持原规则。

## 更新

DSH `0.2.0-rc.2` 的插件页暂不支持自动更新。先在插件管理器卸载 FishFM，再添加新版固定版本或 `dsh-feiyufm-core@beta`，安装完成后点击「立即启用」。必要时正常退出 DSH（含托盘）再启动；卸载或重启期间音乐会中断。

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
- **有歌名却不能播放：** 新源码的歌名来自网易云候选，但播放仍可能受会员、版权或地址失效限制；首包还有模型歌名核对阶段。以实际错误为准。
- **没有声音：** 先查看声音开关、静听模式和暂停状态，再检查系统音量及输出设备。日常 / 专注模式会恢复声音。
- **没有候选：** 检查输入曲库、歌单核对结果与探索池状态，必要时重新核对或点播曲库歌曲。
- **源码改动没有生效：** UI 修改后运行 `npm run build:client` 或 `npm run build`，再刷新界面。官方桌面版会缓存后端模块；后端或资源路由更新需从托盘完整退出 DSH 再启动，只关窗口、刷新页面或停用再启用插件不足以清除缓存。已发布 npm 安装不会自动取得尚未发布的源码改动。
- **悬浮条显示错误：** 可从抽屉内重试或重新核对；只有 Core 不可达才标为断连。

## 验证与边界

最新补验见 [N23](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N23-model-route-completion.md)：真实平台候选经模型选出歌曲、入选曲的 WPF 静音进度与日常原生 Desktop 正常退出重开已通过；输出耗尽和只有推理无答案分别提示，默认额度仍为 256，可在推荐设置调到 4096，仍受共享日预算限制。前轮 Windows 实包、DPAPI、真人扫码、导入／听音／控制与停用证据在 [beta.3 验收](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3-acceptance.md)。最新测试计数与最终包状态只在开发路线维护；首包和 U12 历史 tarball 不能代替本轮安装包。

当前默认从 5 个持有者开始，按实际 Open 耗时最多补齐到 8 个；独立实测用了 6 个，后续加载 484ms。首曲仍冷，预热/打开时间随环境变化。`FISHFM_PLAYBACK_WARM_HOLDERS=0..8` 可指定固定数量，0 关闭。

macOS 真机、完整窗口组合、DSH 请求／上下文对照、多会话和筛选质量仍待验证。两小时连续观察已由用户 2026-10-16 取消，不记为通过；逐曲零模型请求及 DSH 对照要求保留。当前状态统一见开发状态，短跑按 [N7](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N7-short-run.md) 的日期和范围阅读；模拟预览和引用审计不能替代真实验收。

## 许可

原创代码和文档使用 [MIT License](../LICENSE)。依赖和素材按 [第三方声明](../THIRD_PARTY_NOTICES.md) 处理；用户提供的锅盖鲸鱼娘 GIF、静态衍生图及截图中的对应角色图像不在本项目 MIT 授权范围内，作者与许可待确认。
