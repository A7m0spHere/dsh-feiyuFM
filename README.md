# 肥鱼电台 FishFM

<img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/hero.svg" width="100%" alt="肥鱼电台 FishFM：给正在工作的 DeepSeek 一副耳机。">

**DeepSeek Harness（DSH）的社区音乐插件。** 导入你常听的歌曲，让网易云找来推荐，再由模型挑出一批，大肥鱼就能沿着歌单继续听。你随时可以点播、暂停、换曲或静音。

[开始使用](#开始使用) · [推荐流程](#推荐怎样运行) · [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md) · [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md)

## 界面与版本

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-narrow-dark.png">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-dark.png">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-narrow.png">
  <img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel.png" width="100%" alt="main 源码界面：播放器、大肥鱼的歌单、选歌理由与换批倒计时。">
</picture>

歌曲、艺人和推荐理由直接展示，点击即可播放。模型、用量和预算收入折叠设置；等待挑歌时仍可点播和暂停。

| 获取方式 | 包含内容 |
| --- | --- |
| **npm 测试版** | `0.1.0-beta.2` 已发布，包含平台推荐 → 模型筛选、新歌单界面、播放中断恢复与播放动效。[发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.2.md) |
| **当前 `main` 源码** | 在 beta.2 基础上增加分区布局、换批倒计时与更清楚的请求反馈，尚未发布到 npm。[布局](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/U15-balanced-layout.md) · [冷却与反馈](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/spikes/U16-recommendation-feedback.md) |

截图按屏宽和浅深色偏好切换，宽屏展示完整分区，窄屏聚焦播放器与歌单。2026-10-07 从当前客户端隔离预览截取，歌曲、账号状态和模型数据均为模拟内容，不代表生产账号或推荐质量。

## 开始使用

支持 **Windows + 网易云音乐**。已实测 DSH 桌面版 `0.2.0-rc.2`；其他宿主版本尚未验证。需要 Node.js `>=24.14.0 <25`，桌面宿主自带兼容 Node 24 时无需另装。

在 DSH「插件 → 添加插件」的「包名或地址」中输入：

```text
dsh-feiyufm-core@0.1.0-beta.2
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
<summary>从 main 体验最新布局与倒计时</summary>

在上述 Windows / Node 环境中构建：

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

在 DSH「插件 → 添加插件」中填写**仓库的绝对目录**，安装后点击「立即启用」。`dist/` 是构建产物，不是独立安装器。

源码安装不会自动更新已安装的 npm 包。切换来源前通过插件管理器处理原安装；后端改动需从托盘完整退出 DSH，再启动。

</details>

## 推荐怎样运行

**参考歌曲 → 网易云找歌 → 模型挑歌 → 本地播放。**

网易云返回相似歌曲、每日推荐等候选；模型结合参考歌曲与反馈挑选，并给出简短理由。电台从入选歌单中选歌、续播，记录有效收听经历，供之后推荐参考。

模型按批调用，逐曲执行不请求模型。筛选设有 **15 分钟** 冷却，每天最多 **12 次**，与其他音乐模型任务共用 token 预算，用量可在推荐设置查看。换批失败保留同账号仍有效的旧歌单，没有可用入选歌曲时可手动点播参考曲库。

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

- **为什么暂时不能换一批？** 模型筛选受冷却、次数和预算限制。`main` 会显示倒计时或具体原因；beta.2 仍使用原提示。等待期间可以点播、暂停或换曲。
- **为什么没有声音？** 检查声音开关、静听模式、暂停状态，以及系统音量和输出设备。首次播放可能等待数秒。
- **安装后没看到截图中的新布局？** 图中为 `main`，U15/U16 尚未收入已发布的 beta.2；源码体验方法见上方折叠说明。

项目仍是测试版。真实网易云登录、导入与播放已有部分验证；新推荐流程已完成本机测试与隔离界面检查，生产宿主尚未重载。真实模型筛选质量、两小时运行和完整多会话验收仍待完成，QQ 接入暂缓。最新状态统一见 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

## 数据、开发与许可

曲库、偏好、反馈、收听历史与用量账本保存在本机，默认位置为 `$DSH_HOME/fishfm/music.sqlite`。网易云会话使用 Windows DPAPI 加密，数据库只保存凭据引用；Cookie、运行数据库和音频不入库。

模型接收有大小上限的歌名、艺人、反馈、关系和候选曲目键，不接收 Cookie 或凭据。字段与存储边界见 [架构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/ARCHITECTURE.md) 与 [控制契约](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/CORE_CONTRACT.md)。

开发、测试和隔离预览从 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md) 开始；目录和命令见 [仓库结构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/REPOSITORY.md) 与 [脚本索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/scripts/README.md)。

原创代码与文档采用 [MIT License](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/LICENSE)。依赖与素材遵循各自许可；用户提供的 GIF、衍生图和 Workshop doll PNG 不属于本项目 MIT 授权范围。截图使用自有状态图，来源见 [第三方声明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/THIRD_PARTY_NOTICES.md) 与 [依赖许可](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/DEPENDENCY_LICENSES.md)。

感谢 DSH、网易云社区 API，以及提供界面和交互参考的 PHL、dsh-api-dashboard、DeepSeek Balance Whale Widget、Navidrome 和 Music Assistant。FishFM 是独立维护的社区项目。
