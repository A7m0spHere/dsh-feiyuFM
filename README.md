# 肥鱼电台 FishFM

<img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/hero.svg" width="100%" alt="肥鱼电台 FishFM：给正在工作的 DeepSeek 一副耳机。">

**在 DeepSeek Harness（DSH）里，开一间由你掌控的电台。** 导入常听的歌曲，让网易云找来候选，再由模型挑出一批。大肥鱼陪着当前歌曲待在主面板里，你随时可以点播、暂停、换曲或静音。

**Windows · 网易云 · Beta**　[安装 beta.3](#开始使用) · [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3.md) · [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md) · [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md)

## 电台长什么样

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-narrow-dark.png?v=20261102">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-dark.png?v=20261102">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-narrow.png?v=20261102">
  <img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel.png?v=20261102" width="100%" alt="FishFM 当前源码客户端：大肥鱼与当前歌曲、可选歌曲池和底部播放控制。">
</picture>

当前源码（`main`）的隔离预览，按浅深色和屏宽切换。歌曲、账号状态与模型结果均为模拟数据；截图展示当前源码的界面；已发布的 beta.3 仍是旧版主面板。

主面板采用陪伴电台布局：大肥鱼与当前歌曲并列，下方是整个可选歌曲池，播放控制在面板底部常驻。顶部四个页面——正在听、发现记录、偏好与反馈、电台设置——共用一个音乐服务，切换页面不会中断播放；可隐藏的悬浮条也共用同一服务。界面支持浅色、深色和减少动态效果，工作区左缘还可选 ASCII 频谱背景。

## 开始使用

在 DSH「插件 → 添加插件」的「包名或地址」中输入：

```text
dsh-feiyufm-core@0.1.0-beta.3
```

安装完成后点击「立即启用」。首次使用只需三步：

1. 打开侧栏「肥鱼电台」，在「电台设置」里用网易云 App 扫码登录。
2. 从近期播放、喜欢的歌曲或指定歌单导入参考歌曲。
3. 用 DSH 已配置的模型挑歌，或直接点播输入曲库。没有模型也能手动听歌。

跟随测试版可安装 `dsh-feiyufm-core@beta`。升级时在插件管理器卸载旧来源、添加新版，保留同一 profile 的音乐数据库；后端更新后完整退出 DSH（含托盘）再启动。同一 profile 只启用一份 FishFM。

> 仓库 `main` 已包含尚未发布的陪伴界面、设置标签页、ASCII 频谱、持续补歌规则、R3/R4 播放延迟优化与 UI 单入口清理；已发布的 beta.3 仍是旧版界面与按批换歌。安装说明以 beta.3 为准，源码安装见 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。

<details>
<summary>通过 DSH CLI 安装</summary>

以 Web profile 为例，`web` 应对应你实际启动的 profile：

```sh
dsh plugin --profile web add dsh-feiyufm-core@0.1.0-beta.3 --registry https://registry.npmjs.org/
```

安装后重启该实例。单独 `npm install` 不会完成 DSH 插件注册和启用。

</details>

## 推荐怎样运行

**参考歌曲 → 网易云找歌 → 模型挑歌 → 本地播放。**

网易云提供相似歌曲、每日推荐等真实候选；模型结合参考歌曲与反馈挑选，并给出简短理由。电台只从入选歌单中自主选歌、续播，记录有效收听经历，供后续推荐参考。

当前源码按整个入选池的余量持续补歌：窗口外可播余量降到 12 首时补充、补到 24 首停止；初始日预算 100000 tokens，取消筛选的固定每日次数与成功冷却，相同候选和已评审的偏好不重复请求。自动续播、普通下一首和推荐队列都不得选择最近 50 次真正开始的歌曲；没有窗口外可播歌曲时等待补批，不靠重播续播。逐曲播放和「下一首」始终在本地执行，不请求模型。

已发布 beta.3 仍是按批换歌、后台筛选限频的旧规则，差异见 [开发状态](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

“听歌”指选歌、播放与收听记录形成的体验，当前不做音频理解。播放范围受网易云账号权限和资源限制影响。

## 控制始终在你手里

| 操作 | 效果 |
| --- | --- |
| 点播、暂停、下一首 | 随时接管播放；自动事件不能撤销用户暂停 |
| 喜欢／少推荐 | 调整后续推荐，可撤销；不改动网易云收藏 |
| 正在听／发现记录／偏好与反馈／电台设置 | 四个页面共用同一播放与设置状态，切页保留未保存的草稿 |
| 日常／专注／静听／关闭 | 切换听歌方式；静听关闭电脑声音，继续记录有效经历 |
| 今天停止 | 停止当日自主听歌，可手动恢复 |
| 隐藏悬浮条、切换页面 | 音乐服务继续运行，控件可重新打开 |
| 角色区小开关 | 无文字的左右开关，切换 doll 彩蛋；默认关闭，可键盘操作 |
| 背景频谱 | 对话区左缘的 ASCII 频谱，可关闭；模拟观感，不是音频测量 |

<details>
<summary>没有声音，或暂时不能补充歌单？</summary>

- **没有声音：** 检查声音开关、静听模式、暂停状态，以及系统音量和输出设备。首次播放可能等待数秒。
- **不能补充歌单（beta.3 为「换一批」）：** 当前任务、预算或平台节流可能限制请求；余量不足时后台也会自动补充，等待期间仍可点播、暂停或换曲。
- **升级后没有变化：** 后端模块可能仍在缓存中，请从托盘完整退出 DSH 再启动。升级不需要删除音乐数据库。

更多排查方法见 [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md#常见问题)。

</details>

## 支持范围与当前状态

| 项目 | 范围 |
| --- | --- |
| Windows + 网易云 | 已发布 `0.1.0-beta.3`，npm 与官方 DSH 安装链路均已验证 |
| DSH / Node.js | 本机隔离验证 DSH `0.2.1-rc.5`；Node `>=24.14.0 <25`，桌面宿主自带兼容版本时无需另装 |
| macOS | 实验性适配随包提供；真实登录、音频与退出生命周期仍待真机验收 |
| QQ 音乐 | 接入暂缓，当前没有可用登录与播放链路 |

beta.3 包含模型最终回答校验、可调输出额度、DPAPI／PowerShell 5.1 修复、全库搜索与手动换批优化，并修复旧导入写回、退出清理误报和迟到快照覆盖问题。完整变更见 [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3.md)。

仓库 `main` 在 beta.3 之后包含陪伴界面、设置标签页、ASCII 频谱、最近 50 次硬性防重复、按池持续补歌、R3/R4 播放延迟优化与 UI 单入口清理，均未随 npm 包发布。最近一次全套离线回归与验证边界统一见 [开发状态](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。当前 Beta 不代表稳定 v0.1 验收完成。

## 数据与开发

曲库、偏好、反馈、收听历史和用量账本保存在本机，默认位于 `$DSH_HOME/fishfm/music.sqlite`。Windows 用 DPAPI、macOS 实验性适配用 Keychain 保存网易云会话；数据库只保存凭据引用。模型接收有界的音乐事实，不接收 Cookie 或凭据。字段与存储边界见 [架构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/ARCHITECTURE.md) 和 [控制契约](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/CORE_CONTRACT.md)。

[参与开发与源码安装](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md) · [仓库结构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/REPOSITORY.md) · [反馈问题](https://github.com/A7m0spHere/dsh-feiyuFM/issues)

鲸鱼娘（大肥鱼）形象由 **@ZipZipPipe** 基于 **上善无形** 的原创角色进行二次设计。来源与完整版权说明见 [版权声明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/THIRD_PARTY_NOTICES.md)。
