# 肥鱼电台 FishFM · dsh-feiyuFM

给正在 DSH 里工作的 DeepSeek 一副耳机。

**2026-10-01 登录修复：** 已在本机官方桌面版完成真实网易云授权，保留原始错误码并对临时 502 使用同二维码的有界重试；账号校验成功后才加密保存。曲目导入/平台音频仍待验证。社区方案与证据见 [U6](docs/spikes/U6-qr-login-repair.md)。下方此前的未登录状态为历史记录。

从用户近期常听的音乐建立成长环境，由本地策略形成 Agent 的音乐偏好、记忆和自主选择；用户始终保留播放控制权。v0.1 同时支持网易云音乐和 QQ 音乐，并提供 DSH 页面内可隐藏的音乐控制悬浮条。UI 参考 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的右下角挂件、状态泡泡和菜单分层；鲸鱼娘图像仅作为音乐状态的动态视觉，不加入桌宠行为。

**当前状态：开发预览，真实平台导入与播放闭环尚未完成。** 已有控制核心、独立播放服务（本地音频已通过）、DSH 插件 bundle、双平台离线适配、人格与成长及多 Session 判定。DSH `0.2.0-rc.1` 接入了“肥鱼电台”主面板与 `shell.overlay` 音乐状态条。网易云接入固定版本社区 Node API；PHL“2”已有 DPAPI 会话经真实 `login_status` 检查后判为过期，未导入歌曲，需要在运行中的实例重新扫码。QQ 端点尚未核实，因此暂不提供登录按钮。PHL 当前 Web 服务未运行，新 UI 视觉验收待实例重启；项目尚未发布。逐项状态见[开发路线](docs/PROJECT_PLAN.md)。

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

真实宿主接口、第三方能力和播放后端仍待验证；离线测试通过不代表真实平台验收通过。下一步按 [Phase 0](docs/PHASE_0.md) 验证 DSH 接入、双平台真实播放与桌面进程边界。

## 跨设备开发

公开仓库：[A7m0spHere/dsh-feiyuFM](https://github.com/A7m0spHere/dsh-feiyuFM)。新设备克隆后，让开发 Agent 先读取根目录 `AGENTS.md` 和项目规划。

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
```

每次开始工作前，在工作区干净时同步；独立工作使用单独分支：

```sh
git switch main
git pull --ff-only
git switch -c codex/your-task
```

完成后提交本次相关文件并推送分支。在另一台设备继续同一任务时，先 `git fetch origin`，再切换对应分支并 `git pull --ff-only`。未提交的本地改动不会跨设备同步，推送需要有仓库写权限的 GitHub 账号。

账号凭据、Cookie、运行数据库和音频文件留在各设备本地，不通过仓库同步。
