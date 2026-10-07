# 交付与使用说明

更新日期：2026-10-07。已发布首包为 **0.1.0-beta.1 Windows／网易云测试版**，尚未完成稳定 v0.1 验收。`main` 已包含 U12/U13 彩蛋、N21 播放中断恢复与 U14 紧凑布局，但没有发布新的 npm 版本；普通 `@beta` 安装仍取得首包。本文说明安装与使用，发行确认和摘要见 [首包记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.1.md)，源码/发布/实包与验收状态统一见 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

## 支持范围

| 项目 | 当前范围 |
| --- | --- |
| 系统 | Windows，真实播放依赖 WPF `MediaPlayer` 与命名管道；其他系统未验证 |
| Node.js | `>=24.14.0 <25`；使用内置 `node:sqlite` |
| DSH | 本机官方桌面 `0.2.0-rc.2` 已安装并验证部分真实交互；其他版本需验证 |
| 网易云 | 扫码、账号校验、导入、点播与自主续播已有真实验证；会员、版权与资源限制由平台决定 |
| QQ 音乐 | 接入暂缓，保留适配代码和后续范围；当前无可用登录与播放链路 |
| UI | DSH 侧栏主面板、设置页与 `shell.overlay`；不提供独立桌面窗口或托盘 |
| 模型 | 可选，复用 DSH 已配置的模型；歌单生成、总结和候选筛选共用预算与账本 |

## 安装

FishFM 以 npm 包分发，通过 DSH 安装到当前 profile。在侧栏「插件 → 添加插件」的「包名或地址」中输入 `dsh-feiyufm-core@0.1.0-beta.1`，安装完成后点击「立即启用」；跟随 beta 更新用 `dsh-feiyufm-core@beta`。下载失败可切换「安装源 → npm 官方源」。DSH 会安装 bundle、读取 patch 并登记插件，无需手改 profile；单独 `npm install` 不会完成这一步。机制见 [DSH 官方安装说明](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)。

已安装 DSH CLI 的用户可通过 `dsh plugin --profile web add dsh-feiyufm-core@0.1.0-beta.1 --registry https://registry.npmjs.org/` 安装到 Web profile；`web` 要对应实际启动的 profile，安装后重启该实例。桌面版使用上述应用内入口。

支持 Windows、DSH 本机验证版本 `0.2.0-rc.2`；桌面宿主自带兼容 Node 24 时无需单独安装 Node。QQ 与其他系统不在首包已验证范围内。

打开侧栏「肥鱼电台」或设置中的同名页，在网易云卡片扫码、手机确认，再导入歌曲。模型是可选功能，使用用户自己的 DSH 配置；没有模型可点播输入歌曲。

已有 workspace 安装请经插件管理器更换来源，不在同一 profile 同时启用两份 FishFM。仓库开发步骤在 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。包包含运行依赖树、源码与各自许可，安装不需重新解析这些依赖。

## 首次听歌

当前源码的角色图下有一枚无文字的小开关，默认位于左侧，可以自行尝试另一侧。素材在当前仓库与打包清单中提供，无需 Wallpaper Engine 或手动提取；已上架首包尚无此功能。同源窗口即时同步、高窄面板适配已在 U13 隔离验证，真实生产窗口组合仍待验。

导入后，可直接点播输入曲库中的歌曲。自主听歌与电脑声音是独立开关：静听保留自主听歌但关闭声音，暂停冻结进度且不会被自动事件撤销。「今天停止」还会禁止当日自主行为，可通过「恢复自主听歌」解除。

模型推荐模式可生成具体歌单，平台核对后才使用相应曲目；探索池还可使用平台召回候选，并由模型低频筛选排序。失败会显示原因，歌单可重新核对。用户主动「下一首」在默认候选耗尽时回退输入并说明来源，自主续播保持歌单/探索候选边界。平台推荐保留为显式兼容选项。

主面板、设置页与悬浮条共用 Core。隐藏悬浮条或切换页面继续播放，停用插件会停止其后台服务与播放。模型总结、歌单与候选筛选是低频调用，受开关、冷却、每日次数和共享 token 预算约束；逐曲播放不请求模型。

## 更新

DSH `0.2.0-rc.2` 的插件页暂不支持自动更新。先在插件管理器卸载 FishFM，再添加新版固定版本或 `dsh-feiyufm-core@beta`，安装完成后点击「立即启用」。必要时正常退出 DSH（含托盘）再启动；卸载或重启期间音乐会中断。

数据库与凭据位于 DSH 数据目录，不在 npm 包目录。不要手动删除数据库来完成升级；使用同一 profile 保留原数据，升级后核对歌曲、偏好与暂停状态。

## 数据与凭据

| 内容 | 位置与处理 |
| --- | --- |
| SQLite | `$DSH_HOME/fishfm/music.sqlite`，本机通常为 `~/.dsh/fishfm/music.sqlite`；调试入口可用 `--db` 指定 |
| 账号会话 | 数据目录内的 `credentials/*.dpapi`，使用 DPAPI CurrentUser 加密；SQLite 只存引用 |
| 本地记录 | 输入音乐、偏好、反馈、收听历史、成长、约束与模型 token 账本 |
| 模型事实包 | 有界的歌名、艺人、反馈、关系等；歌单生成不发平台 ID，候选筛选含曲目键；不发 Cookie 或凭据 |

凭据绑定当前 Windows 用户，不随 Git 同步，也不能依靠复制密文跨设备登录。登出会清理凭据及其引用。偏好重置与输入曲库清空是两个可恢复入口，不用于登出；删除数据库是完整清除本地数据，请先确认是否需要备份。

仓库不保存 Cookie、运行数据库或音频。测试 WAV 由脚本现场生成。

## 常见问题

- **已保存会话却不能导入：** 会话可能过期，查看错误阶段并重新登录；加密文件存在不代表账号有效。
- **有歌名却不能播放：** 模型推荐需平台核对，歌曲还可能受到会员、版权或地址失效影响；以实际错误为准。
- **没有声音：** 先查看声音开关、静听模式和暂停状态，再检查系统音量及输出设备。日常 / 专注模式会恢复声音。
- **没有候选：** 检查输入曲库、歌单核对结果与探索池状态，必要时重新核对或点播曲库歌曲。
- **源码改动没有生效：** UI 修改后运行 `npm run build:client` 或 `npm run build`，再刷新界面。官方桌面版会缓存后端模块；后端或资源路由更新需从托盘完整退出 DSH 再启动，只关窗口、刷新页面或停用再启用插件不足以清除缓存。已发布 npm 安装不会自动取得尚未发布的源码改动。
- **悬浮条显示错误：** 可从抽屉内重试或重新核对；只有 Core 不可达才标为断连。

## 验证与边界

网易云真实链路见 [P3](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/P3-real-loop.md)，设置和重启恢复见 [N10](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N10-feedback-reset.md)，一次模型歌单生成见 [N11](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N11-model-playlist.md)。最近全量基线为 [N21](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N21-playback-interruption-recovery.md) 的 408 项；[U14](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/U14-compact-layout.md) 紧凑布局另完成 54 项相关测试、126 模块、构建与隔离浏览器复验，没有重跑音频全量或重载生产。首包和 U12 历史实包分别验证了安装与资源，不等于当前生产平台播放验收；历史 tarball 不包含后续开关样式及 U13/N21/U14 修复。

当前默认从 5 个持有者开始，按实际 Open 耗时最多补齐到 8 个；独立实测用了 6 个，后续加载 484ms。首曲仍冷，预热/打开时间随环境变化。`FISHFM_PLAYBACK_WARM_HOLDERS=0..8` 可指定固定数量，0 关闭。

本轮没有重载生产宿主；U12/U13 完整真实窗口组合、两小时、DSH 请求/上下文对照、多会话、模型筛选质量和部分故障恢复仍待验证。N12–N20 的加载边界按各执行记录理解，不把用户可能自行重启当作已完成验收。当前状态统一见 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)，短跑证据见 [N7](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/N7-short-run.md)。模拟预览和引用审计不能替代真实验收。

## 许可

原创代码和文档使用 [MIT License](../LICENSE)。依赖和素材按 [第三方声明](../THIRD_PARTY_NOTICES.md) 处理；用户提供的锅盖鲸鱼娘 GIF、静态衍生图及截图中的对应角色图像不在本项目 MIT 授权范围内，作者与许可待确认。
