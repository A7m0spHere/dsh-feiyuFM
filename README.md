# 肥鱼电台 FishFM

<img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/hero.svg" width="100%" alt="肥鱼电台 FishFM：给正在工作的 DeepSeek 一副耳机。">

**DeepSeek Harness（DSH）的社区音乐插件。** 导入你常听的歌曲，让网易云找来推荐，再由模型挑出一批，大肥鱼就能沿着歌单继续听。你随时可以点播、暂停、换曲或静音。

[开始使用](#开始使用) · [推荐流程](#推荐怎样运行) · [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md) · [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md)

## 界面与版本

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-narrow-dark.png">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-dark.png">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-narrow.png">
  <img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel.png" width="100%" alt="历史源码界面：播放器、大肥鱼的歌单与选歌理由；当前手动换批已取消倒计时。">
</picture>

歌曲、艺人和推荐理由直接展示，点击即可播放。模型、用量和预算收入折叠设置；等待挑歌时仍可点播和暂停。

| 获取方式 | 包含内容 |
| --- | --- |
| **npm 测试版** | 本次发行版本 `0.1.0-beta.3`：DPAPI/PowerShell 5.1、模型最终回答校验、可调输出额度、慢导入控制与全库搜索，以及导入重置、退出清理和快照去旧修复。[发行状态](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3.md) |
| **当前 `main` 源码** | 与 beta.3 本次运行实现一致；macOS 适配随包提供，仍为实验性且待真机验收。[验收与剩余工作](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md) |

截图按屏宽和浅深色偏好切换，宽屏展示完整分区，窄屏聚焦播放器与歌单。截图来自 2026-10-07 隔离预览，歌曲、账号状态和模型数据均为模拟内容；图中的倒计时属于历史界面，U18 已移除，不代表当前推荐质量。

## 开始使用

本次 npm `0.1.0-beta.3` 的已验证范围是 **Windows + 网易云音乐**。macOS 的 AVFoundation 播放宿主、Unix socket IPC 与 Keychain 凭据适配随包提供；历史移植记录确认了 Helper 编译和本地 profile 加载，真实登录、音频与退出链路仍待真机验证。需要 Node.js `>=24.14.0 <25`，桌面宿主自带兼容 Node 24 时无需另装。

在 DSH「插件 → 添加插件」的「包名或地址」中输入：

```text
dsh-feiyufm-core@0.1.0-beta.3
```

安装后点击「立即启用」，再完成三步：

1. 打开侧栏「肥鱼电台」，展开「音乐平台」，用网易云 App 扫码登录。
2. 从近期播放、喜欢的歌曲或指定歌单导入参考歌曲。
3. 使用 DSH 已配置的模型挑歌，或直接点播输入曲库。没有模型也能手动听歌。

跟随测试版可安装 `dsh-feiyufm-core@beta`。更新与数据保留见 [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md)；同一 profile 只启用一份 FishFM。

<details>
<summary>通过 DSH CLI 安装</summary>

以 Web profile 为例，`web` 应对应你实际启动的 profile：

```sh
dsh plugin --profile web add dsh-feiyufm-core@0.1.0-beta.2 --registry https://registry.npmjs.org/
```

安装后重启该 DSH 实例。单独 `npm install` 不会完成 DSH 插件注册和启用。

</details>

<details>
<summary>从 main 体验最新布局与手动找歌</summary>

在 Windows / Node 环境中构建：

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

在 DSH「插件 → 添加插件」中填写**仓库的绝对目录**，安装后点击「立即启用」。`dist/` 是构建产物，不是独立安装器。

源码安装不会自动更新已安装的 npm 包。切换来源前通过插件管理器处理原安装；后端改动需从托盘完整退出 DSH，再启动。

macOS 上可把仓库绝对路径作为插件来源添加到实际桌面 profile，例如：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-feiyuFM
```

macOS 当前仅指 `main` 源码版；首次使用原生播放或 Keychain 时需要可用的 `/usr/bin/swiftc`（Xcode Command Line Tools），Helper 会编译到 `$DSH_HOME/fishfm/hosts`。桌面后端改动需从托盘完整退出 DSH 后再启动。已发布 npm beta.2 仍是 Windows 版本。

</details>

## 推荐怎样运行

**参考歌曲 → 网易云找歌 → 模型挑歌 → 本地播放。**

网易云返回相似歌曲、每日推荐等候选；模型结合参考歌曲与反馈挑选，并给出简短理由。电台从入选歌单中选歌、续播，记录有效收听经历，供之后推荐参考。

模型按批调用，逐曲执行不请求模型。当前 `main` 的手动找歌/换批取消 **15 分钟** 模型冷却等待；后台自动筛选仍受冷却约束。手动和自动请求都保留并发限制、每天最多 **12 次**及共享 token 预算，用量可在推荐设置查看。平台刷新节流与相同候选缓存仍生效；已发布 beta.2 保留原冷却规则。换批失败保留同账号仍有效的旧歌单，没有可用入选歌曲时可手动点播参考曲库。

“听歌”指选歌、播放和收听记录形成的体验，当前不做音频理解。播放范围受网易云账号权限和资源限制影响，完整规则见 [产品规格](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/MVP.md)。

## 控制始终在你手里

| 操作 | 效果 |
| --- | --- |
| 点播、暂停、下一首 | 随时接管播放，用户暂停优先 |
| 喜欢 / 少推荐 | 调整后续推荐，可撤销；不改动网易云收藏 |
| 日常 / 专注 / 静听 / 关闭 | 切换听歌方式；静听关闭电脑声音，继续记录有效经历 |
| 今天停止 | 停止今天的自主听歌，可手动恢复 |
| 隐藏悬浮条、切换页面 | 音乐服务继续运行，控件可重新打开 |

主面板、设置页和悬浮条共用同一个音乐服务，支持浅色、深色和减少动态效果。

## 常见问题与当前边界

- **为什么暂时不能换一批？** 当前 `main` 手动找歌没有模型冷却倒计时，但任务占用、每日次数、预算和平台节流仍可能限制请求；beta.2 保留原冷却提示。等待期间可以点播、暂停或换曲。
- **为什么没有声音？** 检查声音开关、静听模式、暂停状态，以及系统音量和输出设备。首次播放可能等待数秒。
- **安装后没看到截图中的新布局？** 图中为 `main`，U15/U16 尚未收入已发布的 beta.2；源码体验方法见上方折叠说明。

项目仍是测试版。2026-10-12 的 beta.3 补验已完成真实模型筛选、入选曲静音播放与日常原生 Desktop 正常退出重开；兼容服务须使用能正确关闭推理的模型路线。实包安装与 DPAPI 检查通过；当轮实际观察 54.72 分钟后按用户要求结束，16 条有效收听、0 播放错误。2026-10-13 补上三个 GitHub 问题修复；两小时、完整 DSH 对照、并发多会话、跨设备和 macOS 真机仍待验，QQ 接入暂缓。报告见 [beta.3 验收](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.3-acceptance.md)，最新计数与剩余工作统一见 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

## 数据、开发与许可

曲库、偏好、反馈、收听历史与用量账本保存在本机，默认位置为 `$DSH_HOME/fishfm/music.sqlite`。Windows 使用 DPAPI、macOS 源码版使用 Keychain 保存网易云会话，数据库只保存凭据引用；Cookie、运行数据库和音频不入库。

模型接收有大小上限的歌名、艺人、反馈、关系和候选曲目键，不接收 Cookie 或凭据。字段与存储边界见 [架构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/ARCHITECTURE.md) 与 [控制契约](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/CORE_CONTRACT.md)。

开发、测试和隔离预览从 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md) 开始；目录和命令见 [仓库结构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/REPOSITORY.md) 与 [脚本索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/scripts/README.md)。

原创代码与文档采用 [MIT License](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/LICENSE)。依赖与素材遵循各自许可；用户提供的 GIF、衍生图和 Workshop doll PNG 不属于本项目 MIT 授权范围。截图使用自有状态图，来源见 [第三方声明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/THIRD_PARTY_NOTICES.md) 与 [依赖许可](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/DEPENDENCY_LICENSES.md)。

感谢 DSH、网易云社区 API，以及提供界面和交互参考的 PHL、dsh-api-dashboard、DeepSeek Balance Whale Widget、Navidrome 和 Music Assistant。FishFM 是独立维护的社区项目。
