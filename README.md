# 肥鱼电台 FishFM · dsh-feiyuFM

给正在 DSH 里工作的 DeepSeek 一副耳机。

**2026-10-02 UI 完善：** 主播放器、曲库和悬浮条采用 PHL 的冷灰/蓝色卡片风格；鲸鱼娘缩小为状态插画。支持曲库搜索/分页/点播、菜单进退场、键盘导航与完整/轻量/关闭动效。QQ 接入按用户要求暂缓，当前优先完善网易云体验。实现与验证见 [U7](docs/spikes/U7-phl-ui-motion.md)。

**2026-10-02：网易云首条真实播放闭环通过。** 已恢复现有会话，导入 100 首近期歌曲，完成点播、暂停/恢复、下一首、离开面板续播、停用和重新启用暂停恢复；用户确认声音正常。主面板可选择已导入曲目播放。仍是开发预览：QQ、两小时运行及完整验收未完成。证据见 [P3](docs/spikes/P3-real-loop.md)，下方较早日期的未导入/未播放描述为历史范围。

**2026-10-01 登录修复：** 已在本机官方桌面版完成真实网易云授权，保留原始错误码并对临时 502 使用同二维码的有界重试；账号校验成功后才加密保存。曲目导入/平台音频仍待验证。社区方案与证据见 [U6](docs/spikes/U6-qr-login-repair.md)。下方此前的未登录状态为历史记录。

从用户近期常听的音乐建立成长环境，由本地策略形成 Agent 的音乐偏好、记忆和自主选择；用户始终保留播放控制权。v0.1 同时支持网易云音乐和 QQ 音乐，并提供 DSH 页面内可隐藏的音乐控制悬浮条。UI 参考 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的右下角挂件、状态泡泡和菜单分层；鲸鱼娘图像仅作为音乐状态的动态视觉，不加入桌宠行为。

**当前状态：开发预览。** 网易云 P3 真实导入/播放闭环与本轮 U7 界面完善已通过相应验证；已有 Core、独立 WPF 播放、DSH 主面板/设置席位/浮层，以及本地选歌、偏好成长和会话门控。QQ 接入按用户要求暂缓；备用来源、真实多会话、两小时运行与发布验收仍待完成。逐项状态见[开发路线](docs/PROJECT_PLAN.md)。

**本机桌面版增量（2026-09-30）：** 已适配并安装到官方 DSH `0.2.0-rc.2`，验证主面板、设置保存/重启恢复、停用清理和悬浮条基础交互。默认数据库 `~/.dsh/fishfm/music.sqlite`；范围见 [U5](docs/spikes/U5-official-desktop.md)。此前 PHL 的 UI 待验项目不代表本机桌面 UI 状态，平台音乐闭环仍未完成。

**打开设置：** 本机官方 DSH 左侧栏点击 **肥鱼电台**，或 **账号菜单 → 设置 → 肥鱼电台**。网易云卡片点 **扫码登录**，手机确认后 **导入我的音乐**；设置与凭据保存在本机。其他桌面安装可经 **插件 → 添加插件** 输入仓库绝对目录并启用。

Node 24.14～24.x 下可运行，**大部分检查不需要音乐账号**：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check        # 语法与模块检查
npm test             # 核心、适配器与 UI 测试
npm run build        # 构建 dist/ 并跑调试冒烟
npm run debug        # JSON 行调试入口（假播放，不出声）
```

客户端源码位于 `src/ui/client/`；`src/ui/dsh-client.js` 是 DSH 使用的生成入口。修改后执行 `npm run build:client`，`npm run check` 会检查生成文件是否与源码一致。开发 UI 预览使用 `npm run preview:ui -- --react-root <已有 React 18 的 node_modules 目录>`，仅显示模拟数据，不访问账号或播放声音。

需要账号或会产生声音的入口（**都会明确告诉你它会做什么**）：

```sh
npm run login                          # 扫码登录并保存会话（DPAPI 加密落盘）
npm run login -- --dry-run             # 同上，但不保存任何东西
npm run soak -- --minutes 5 --fake     # 长跑演练：请求计数与资源采样，合成 provider
npm run smoke:playback                 # 播放本地 WAV 验证真实音频，会出声
```

尚未接线的入口（`login` 之外的平台操作仍需要端点配置）：

```sh
npm run core -- --playback fake --provider fake --selection environment
```

调试入口读取 JSON 行。例如依次输入 `{"queue":[{"provider":"netease","providerTrackId":"1","title":"Demo"}]}`、`{"type":"next"}`、`{"type":"resume"}`、`wait`、`snapshot`，可观察状态和假播放服务。`npm run debug -- --db <本地路径>` 可试验重启恢复；不要把数据库提交入库。此入口不播放真实音乐。内部接口与边界见 [Phase 1 控制契约](docs/CORE_CONTRACT.md)。

安装、构建产物、支持范围与已知限制见 [交付说明](docs/DELIVERY.md)。

这是独立维护的 DSH 社区项目，名称呼应 DeepSeek 大肥鱼形象；与大肥鱼插件的关系是实现参考，不要求安装该插件。

## 阅读入口

| 文档 | 用途 |
|---|---|
| [开发路线](docs/PROJECT_PLAN.md) | 阶段任务、前置依赖、交付条件、验收映射与跨设备交接 |
| [自主听歌与推荐规划](docs/AUTONOMOUS_MUSIC_ROADMAP.md) | 真实采集、自主续播、发现池、输入画像、种子推荐、成长说明与长期体验的实施设计 |
| [MVP 产品规格](docs/MVP.md) | 范围、用户行为、默认设置与验收标准 |
| [技术架构](docs/ARCHITECTURE.md) | 模块职责、播放生命周期、数据与事件边界 |
| [Phase 0 验证清单](docs/PHASE_0.md) | 开发前必须验证的接口和最小实验 |
| [Phase 1 控制契约](docs/CORE_CONTRACT.md) | 已实现的内部接口、命令和存储语义 |
| [交付说明](docs/DELIVERY.md) | 安装、命令、支持范围、已知限制与素材归属 |
| [决策与参考线索](docs/DECISIONS.md) | 对话来源、取舍、待验证项目与本次整理记录 |

## 项目约束

- 自动选歌、探索、状态同步和偏好更新在本地完成；两小时自动听歌新增 LLM 请求数必须为 0。
- 音乐不得阻塞 DSH 的任务、工具、构建和测试。
- 用户音乐环境与 Agent 偏好分开保存，用户命令优先于自主选择。
- 两个平台的适配器由项目维护，参考社区实现；余额挂件只作 UI 参考，不是运行依赖，不复用其鲸鱼素材。
- 音乐核心与播放服务独立于可见页面；隐藏悬浮条、切换 DSH 面板或关闭页面不能带走它们。

后续按[自主听歌与推荐规划](docs/AUTONOMOUS_MUSIC_ROADMAP.md)推进：先补真实采集和自主续播/成长记账，再接新歌候选与有来源的偏好推荐，最后做解释和两小时运行；QQ 暂缓。当前真实推荐入口尚未实现，探索会回退曲库；歌曲/艺人初始权重也不等于已形成流派画像。离线通过与本轮 UI 完成不等于全部产品验收通过。

## 跨设备开发

公开仓库：[A7m0spHere/dsh-feiyuFM](https://github.com/A7m0spHere/dsh-feiyuFM)。新设备克隆后，让开发 Agent 先读取根目录 `AGENTS.md` 和项目规划。

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
```

日常开发直接使用 `main`。每次开始工作前，在工作区干净时同步：

```sh
git switch main
git pull --ff-only
```

每项完成的任务形成独立提交，检查通过后推送 `main`。同一任务在两台设备之间串行接续，另一台先切到 `main` 并 `git pull --ff-only`。未提交的本地改动不会跨设备同步，推送需要有仓库写权限的 GitHub 账号。

账号凭据、Cookie、运行数据库和音频文件留在各设备本地，不通过仓库同步。
