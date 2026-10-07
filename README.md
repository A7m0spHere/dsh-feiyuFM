# 肥鱼电台 FishFM

给正在 DSH 里工作的 DeepSeek 一副耳机。

<img src="https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/hero.svg" width="100%" alt="肥鱼电台 FishFM：导入参考歌曲，网易云找歌，模型挑歌，大肥鱼听歌。">

**FishFM 是 DeepSeek Harness（DSH）的社区音乐插件。** 导入你常听的歌曲，让网易云找来推荐，再由模型挑出一批，大肥鱼就可以沿着这份歌单继续听。你随时可以点播、暂停、换曲或静音。

[开始使用](#开始使用) · [推荐流程](#推荐怎样运行) · [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md) · [开发与贡献](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md) · [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md)

> **版本提示：** 本页对应 `0.1.0-beta.2`，包含新歌单流程、播放中断恢复与紧凑界面。旧版 `beta.1` 保留当时的模型歌单与核对界面。版本与验收状态见 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

## 界面预览

![当前源码局部预览：播放器、大肥鱼的歌单、选歌理由与换批操作](https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel.png)

歌单直接显示歌曲、艺人和简短理由，点击即可播放；想换个方向就点「换一批」。模型选择、用量和预算放在折叠的「推荐设置」中。

<details>
<summary>查看深色界面</summary>

![当前源码深色局部预览：播放器与大肥鱼的歌单](https://raw.githubusercontent.com/A7m0spHere/dsh-feiyuFM/main/assets/readme/panel-dark.png)

</details>

截图于 2026-10-07 从实际客户端的隔离预览截取，展示单列布局中的播放器与歌单局部。歌曲和数据为模拟内容，不代表真实账号记录或模型推荐质量。

## 推荐怎样运行

**参考歌曲 → 网易云找歌 → 模型挑歌 → 大肥鱼听歌。**

1. 扫码登录网易云，从近期播放、喜欢的歌曲或指定歌单导入参考歌曲。
2. 网易云返回相似歌曲、每日推荐等候选；模型结合参考歌曲与反馈，从候选里挑选并给出理由。
3. 本地电台从入选歌单选歌、播放和续播，记录有效收听经历，供下一批推荐参考。

模型按批挑歌，**播放和换曲不发模型请求**。自动补充歌单受冷却、每日次数和共享 token 预算限制，用量可在推荐设置查看。换批失败会保留同账号仍有效的旧歌单；没有可用歌单时可以手动点播参考歌曲。播放范围仍取决于网易云账号权限和平台资源。

这里的「听歌」指选歌、播放和收听记录形成的产品体验；当前不做音频理解。完整规则见 [产品规格](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/MVP.md)。

## 你可以怎样听

| 操作 | 效果 |
| --- | --- |
| 点播、暂停、下一首 | 随时接管播放，用户暂停优先 |
| 喜欢 / 少推荐 | 调整后续推荐，可撤销；不改动网易云收藏 |
| 日常 / 专注 / 静听 / 关闭 | 切换听歌方式；静听关闭电脑声音，继续记录有效经历 |
| 今天停止 | 停止今天的自主听歌，可手动恢复 |
| 收起悬浮条或切换页面 | 音乐服务继续运行，控件可重新打开 |

主面板、设置页和悬浮条共用同一个音乐服务，支持浅色、深色与减少动态效果。

## 开始使用

当前支持 **Windows + 网易云音乐**。需要 Node.js `>=24.14.0 <25`；DSH 桌面宿主自带兼容 Node 24 时无需另装。历史实测宿主为 DSH `0.2.0-rc.2`，其他版本尚未验证。自动推荐使用你在 DSH 中已配置的模型；不配置模型也可手动点播导入歌曲。

### 安装到 DSH

在 DSH「插件 → 添加插件」的「包名或地址」中输入：

```text
dsh-feiyufm-core@0.1.0-beta.2
```

安装完成后点击「立即启用」。跟随测试版使用 `dsh-feiyufm-core@beta`；安装与验证范围见 [beta.2 发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.2.md)。打开肥鱼电台后扫码登录、导入参考歌曲，并使用 DSH 已配置的模型挑歌。

<details>
<summary>通过 DSH CLI 安装 beta</summary>

以 Web profile 为例：

```sh
dsh plugin --profile web add dsh-feiyufm-core@0.1.0-beta.2 --registry https://registry.npmjs.org/
```

`web` 必须对应你实际使用的 profile；安装后重启该 DSH 实例。单独运行 `npm install` 不会完成 DSH 插件注册与启用。

</details>

同一 profile 只启用一份 FishFM。安装源切换、更新、数据保留与常见问题见 [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md)。

### 体验当前源码

在上述环境中构建：

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

在 DSH 侧栏打开「插件 → 添加插件」，填入**仓库的绝对目录**，安装后点击「立即启用」。`dist/` 是构建产物，不是独立安装器。

1. 打开侧栏「肥鱼电台」，或「设置 → 肥鱼电台」。
2. 在网易云卡片扫码、手机确认，导入参考歌曲。
3. 确认 DSH 已配置模型，等待挑歌或点击「找一批歌」，再点播入选歌曲。

## 当前状态与数据

项目仍是测试版。最新推荐流程已完成本机测试与隔离界面验证，生产宿主尚未重载；真实模型筛选质量、两小时连续运行和完整多会话验收仍待完成。首次播放可能等待数秒，QQ 接入暂缓。最新进度和证据统一见 [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md)。

曲库、偏好、反馈、收听历史与用量账本保存在本机，默认数据库为 `$DSH_HOME/fishfm/music.sqlite`，常见路径为 `~/.dsh/fishfm/music.sqlite`。网易云会话使用 Windows DPAPI 加密，数据库只保存凭据引用，Cookie、运行数据库和音频不入库。

模型挑歌会收到有大小上限的歌名、艺人、反馈、关系与候选曲目键，不会收到 Cookie 或凭据。字段与存储边界见 [架构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/ARCHITECTURE.md) 和 [控制契约](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/CORE_CONTRACT.md)。

## 开发与文档

```sh
npm run check             # 语法、Node 版本与生成客户端一致性
npm test                  # 核心、适配器、桥接与 UI 逻辑
npm run build             # 生成客户端、构建与调试冒烟
npm run audit:acceptance  # 文档链接与验收证据引用审计
```

客户端源码在 `src/ui/client/`，`src/ui/dsh-client.js` 为生成文件；修改 UI 后运行 `npm run build:client`。隔离预览、真实音频测试与贡献方式见 [贡献指南](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/CONTRIBUTING.md)。

| 入口 | 内容 |
| --- | --- |
| [文档索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/README.md) | 规格、设计、历史证据与发行记录 |
| [仓库结构](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/REPOSITORY.md) · [脚本索引](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/scripts/README.md) | 维护入口与可执行工具 |
| [产品规格](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/MVP.md) · [开发路线](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/PROJECT_PLAN.md) | 行为规则、实施进度与验收状态 |
| [使用说明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/DELIVERY.md) · [发布记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/docs/releases/0.1.0-beta.2.md) | 安装、更新、数据与版本验证 |

## 许可与致谢

项目原创代码与文档采用 [MIT License](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/LICENSE)。运行依赖遵循各自许可，源码与许可随包保留，见 [第三方声明](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/THIRD_PARTY_NOTICES.md) 和 [依赖许可清单](https://github.com/A7m0spHere/dsh-feiyuFM/blob/main/DEPENDENCY_LICENSES.md)。

首个 npm beta 使用三张自有角色 PNG。本页截图也使用自有状态图；当前源码随包的用户提供 GIF、衍生图与 Workshop doll PNG 作者和许可尚未确认，**不属于本项目 MIT 授权范围**，来源与清单保留在第三方声明中。

感谢 DSH、网易云社区 API，以及提供界面与交互参考的 PHL、dsh-api-dashboard 和 DeepSeek Balance Whale Widget。FishFM 是独立维护的社区项目。
