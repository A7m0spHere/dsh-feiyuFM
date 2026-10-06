# 肥鱼电台 FishFM

给正在 DSH 里工作的 DeepSeek 一副耳机。

<p>
  <img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/hero.svg" width="100%" alt="肥鱼电台 FishFM：从你的常听歌曲出发，学习偏好、挑选音乐，在 DSH 中持续听歌。">
</p>

**FishFM 是 DeepSeek Harness（DSH）的社区音乐插件。** 导入你的网易云音乐，以常听歌曲为起点建立本地音乐偏好，让大肥鱼自主选歌、探索新歌；你可以随时点播、暂停、换曲或静音。

**首个公开测试版 `0.1.0-beta.1` 已在 npm 发布。** 当前支持 Windows／网易云，可在 DSH 插件管理器中添加 `dsh-feiyufm-core@beta`。稳定版验收仍在进行，QQ 接入暂缓。

[开始使用](#开始使用) · [npm 包](https://www.npmjs.com/package/dsh-feiyufm-core/v/0.1.0-beta.1) · [功能介绍](#能做什么) · [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md) · [开发与贡献](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md) · [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.1.md)

## 界面预览

![肥鱼电台主面板：播放控制、音乐偏好、模型总结与听歌设置](https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel.png)

<details>
<summary>查看深色界面</summary>

![肥鱼电台深色主面板](https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-dark.png)

</details>

以上截图来自当前客户端的隔离预览，使用模拟歌曲和统计数据，不代表真实账号记录或模型效果。主面板、设置页和可隐藏的悬浮条共用同一个音乐服务；切换 DSH 页面或隐藏控件后仍可继续播放。

<details>
<summary>查看 beta 包安装后的 DSH 界面</summary>

![官方 DSH 隔离环境中的 FishFM beta 包](https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/docs/releases/assets/beta1-ui.png)

来自官方 DSH `0.2.0-rc.2` 的隔离 profile，已验证实包安装、侧栏、图片与设置读写。该环境未登录网易云、曲库为空，完整验证范围见 [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.1.md)。

</details>

## 能做什么

| 功能 | 使用方式 |
| --- | --- |
| 导入你的音乐 | 网易云扫码登录，从近期播放、喜欢的歌曲或指定歌单建立输入曲库 |
| 自主听歌 | 按本地偏好、歌曲关系与重复惩罚选择歌曲，曲终继续播放；用户暂停优先 |
| 找新歌 | 结合相似歌曲、每日推荐和个人歌曲关系，按探索率尝试陌生候选 |
| 可选模型推荐 | 使用 DSH 已配置的模型生成具体歌单、批量筛选新歌或总结音乐偏好 |
| 看懂选歌理由 | 查看「大肥鱼说」、艺人倾向、有效收听和近期偏好变化；未知信息保持未知 |
| 调整推荐 | 对歌曲点「喜欢 / 少推荐」并撤销；偏好重置和输入曲库清空分别提供恢复入口 |
| 控制听歌状态 | 暂停、继续、下一首，以及日常、专注、静听、关闭和「今天停止」 |
| 随时收起 | DSH 内悬浮条可隐藏、重开、拖动和吸附；支持浅色、深色与减少动态效果 |

「静听」会关闭电脑声音，让自主听歌与有效经历继续。音乐偏好、用户反馈和禁播约束分别保存，平台请求失败不会被当成不喜欢一首歌，反馈也不会改动网易云收藏。

### 推荐怎样运行

```text
你的常听歌曲 / 喜欢 / 歌单
          ↓
本地画像与歌曲关系 → 候选召回 / 可选模型歌单与筛选
          ↓
本地逐曲选歌 → 平台核对与资源解析 → 独立播放服务
          ↓
有效收听记录 → 有界偏好更新 → 下一次选择
```

**逐曲选歌、播放和偏好更新不请求模型。** 画像总结、模型歌单、发现候选筛选是低频操作，共用 token 预算，并受冷却与每日上限约束；成功和失败的调用都会记录到账本。自动更新可关闭，模型不可用时界面展示实际状态。

模型歌单会先搜索核对，再播放可匹配的歌曲。歌单暂时没有可播曲目时，用户主动点「下一首」可回退输入曲库并显示原因；自主续播保持歌单边界。完整行为见 [产品规格](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/MVP.md)。

## 开始使用

### 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows；当前真实音频后端使用 WPF `MediaPlayer` |
| Node.js | `>=24.14.0 <25`；DSH 桌面宿主自带兼容 Node 24 时无需单独安装 |
| 宿主 | DSH 桌面版；本机验证版本为 `0.2.0-rc.2`，其他版本尚未验证 |
| 音乐账号 | 网易云音乐；可播放范围取决于账号权限和平台资源 |
| 模型 | 可选，使用 DSH 中已配置的模型；离线开发检查不需要模型或音乐账号 |

### 安装到 DSH

FishFM 以 npm 包分发，但需要通过 DSH 安装到它的 profile。DSH 会下载包、读取 `dsh.bundle` 并登记插件；单独运行 `npm install dsh-feiyufm-core` 不会完成 DSH 的安装与启用。[官方打包与安装说明](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

在 DSH 侧栏打开「插件 → 添加插件」，在「包名或地址」中输入：

```text
dsh-feiyufm-core@beta
```

固定安装当前版本用 `dsh-feiyufm-core@0.1.0-beta.1`。等待安装完成后点击 **立即启用**；下载失败时可将「安装源」切换为「npm 官方源」再试。

1. 点击侧栏 **肥鱼电台**，或进入 **设置 → 肥鱼电台**。
2. 在网易云卡片扫码、手机确认，再导入音乐并点播。
3. 模型功能使用你自己在 DSH 中配置的模型；不需要模型即可点播输入歌曲。

DSH `0.2.0-rc.2` 的插件页暂不支持自动更新。升级时先在插件管理器卸载 FishFM，再添加 `dsh-feiyufm-core@beta` 或新版的固定版本，并点击「立即启用」。已有 workspace 安装也按此方式更换来源，同一 profile 只启用一份 FishFM。数据保存在 DSH 数据目录，升级时使用同一 profile，不删除数据库，之后核对曲库、偏好与暂停状态。

<details>
<summary>使用已安装的 DSH CLI 添加插件</summary>

以 Web profile 为例，在 Windows 终端执行：

```sh
dsh plugin --profile web add dsh-feiyufm-core@0.1.0-beta.1 --registry https://registry.npmjs.org/
```

`web` 必须对应你实际使用的 profile；安装后重启该 DSH 实例。桌面版用户直接使用上面的应用内插件管理器。

</details>

安装、更新、数据位置和常见问题见 [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md)。首次播放仍可能等待数秒，性能边界见下方 [当前进度](#当前进度)。

### 从源码开发

使用上述 Windows 和 Node.js 环境：

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

开发时通过插件管理器添加仓库绝对目录。`dist/` 是开发产物，不是独立安装器；开发检查和真实音频测试要求见 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。

## 当前进度

**`0.1.0-beta.1` 已发布，稳定 v0.1 验收尚未完成。** 网易云真实扫码、导入、播放、自然续播、部分偏好成长、设置持久化与停用恢复已有历史实测；本次发布额外验证了隔离安装与 DSH 页面交互。完整验收状态以 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md) 为准。

- npm 下载包的 SHA-512／SHA-1 与封存包一致；从 registry 全新安装后的入口、图片、Core、WPF 和实际依赖版本检查均 `ALL-PASS`。本机 386 项测试通过；远端 CI 383 项通过，3 项依赖音频环境的回归显式跳过。详情见 [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.1.md)。
- 当前 `beta` 和 `latest` 都指向 `0.1.0-beta.1`；安装建议显式使用 `@beta` 或固定版本。稳定版完成后再更新 `latest`。
- 首次播放仍需数秒；默认从 5 个预热持有者开始，根据实际打开耗时最多补齐到 8 个。显式 `FISHFM_PLAYBACK_WARM_HOLDERS=0..8` 使用固定数量，0 关闭。性能与填池时间随环境变化；真实长期模型筛选质量与生产迁移仍待验证。
- 真实两小时运行、DSH 模型请求/上下文对照与完整多会话验收尚未完成。
- QQ 音乐保留在规划与适配代码中，接入暂缓；当前不提供可用的 QQ 登录与播放链路。其他操作系统未验证。

## 数据与模型

播放核心独立于可见 UI。默认数据存于 `$DSH_HOME/fishfm/music.sqlite`，常见本机位置为 `~/.dsh/fishfm/music.sqlite`。网易云会话使用 Windows DPAPI 加密，数据库只保存凭据引用；运行数据库、Cookie 和音频不会随仓库同步。

使用模型功能时，会发送受大小上限约束的歌曲名称、艺人、反馈与关系等音乐事实；歌单生成不发送平台 ID；候选筛选会发送用于匹配结果的曲目键（含平台与歌曲 ID）。Cookie 和凭据不进入模型事实包。具体字段、预算与持久化边界见 [架构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/ARCHITECTURE.md) 和 [控制契约](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/CORE_CONTRACT.md)。

## 开发

```sh
npm run check             # 模块语法、Node 版本与生成客户端一致性
npm test                  # 核心、适配器、桥接与 UI 逻辑测试
npm run build             # 生成客户端、构建 dist/ 并运行调试冒烟
npm run audit:acceptance  # 验收证据引用审计，不代表真实验收通过
npm run debug             # JSON 行调试入口，使用假播放，不出声
```

客户端源码在 `src/ui/client/`，`src/ui/dsh-client.js` 为生成文件。修改 UI 后执行 `npm run build:client`；隔离预览需要已有 React 18 UMD，详见 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.1.md) | beta 包摘要、安装验证、CI 与剩余依赖告警 |
| [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md) | 当前规格、设计提案和历史证据的统一入口 |
| [交付与使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md) | 安装、更新、数据位置与常见问题 |
| [产品规格](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/MVP.md) | 用户操作、推荐边界与验收标准 |
| [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md) | 实施进度、真实验收与跨设备交接 |
| [架构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/ARCHITECTURE.md) | Provider、Core、Playback 和 UI 的职责 |
| [控制契约](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/CORE_CONTRACT.md) | 内部命令、状态与存储语义 |
| [决策记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DECISIONS.md) | 实现取舍与来源证据 |
| [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md) | 本地开发、问题反馈和提交要求 |

## 许可与致谢

项目原创代码与文档采用 [MIT License](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/LICENSE)。npm beta 包只分发自有三张角色状态 PNG；运行依赖的源码与许可随包保留，按各自许可使用，见 [第三方声明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/THIRD_PARTY_NOTICES.md) 和 [依赖许可清单](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/DEPENDENCY_LICENSES.md)。

仓库历史中的用户提供锅盖鲸鱼娘 GIF 及衍生素材作者与许可尚未确认，不分发到 npm，也不包含在本项目 MIT 授权范围内。本页界面截图使用自有状态图。

感谢 DSH、网易云社区 API，以及提供 UI 风格和交互参考的 PHL、dsh-api-dashboard 与 DeepSeek Balance Whale Widget。具体版本、复用范围和声明见第三方文档。FishFM 为独立维护的社区项目。
