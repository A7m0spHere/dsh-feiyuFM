# 肥鱼电台 FishFM · dsh-feiyuFM

给正在 DSH 里工作的 DeepSeek 一副耳机。

从用户近期常听的音乐建立成长环境，由本地策略形成 Agent 的音乐偏好、记忆和自主选择；用户始终保留播放控制权。v0.1 同时支持网易云音乐和 QQ 音乐，并提供可隐藏的音乐控制悬浮窗。UI 参考 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的右下角挂件、状态泡泡和菜单分层；鲸鱼娘图像仅作为音乐状态的动态视觉，不加入桌宠行为。

**当前状态：离线部分已完成，真实平台尚未验证。** 已有 Phase 1 控制核心、独立播放服务（真实音频已通过）、DSH 插件 bundle（在真实宿主中验证过激活与停用）、网易云与 QQ 适配器（离线）、人格与成长、多 Session 判定、扩展 UI 的桥接与面板逻辑。最近在 DSH `0.2.0-rc.1` 的 PHL 管理 Web 实例安装并加载了本地 bundle，独立 Core 已由该宿主启动；`0.1.7-rc.2` 的工具调用和停用清理实测记录仍有效。**从未与真实音乐平台通信过**：登录/导入/搜索/解析的接口形状是按真实服务实测确认的，端到端仍未跑通，桌面窗口壳未建。逐项状态见[完成度总表](docs/PROJECT_PLAN.md#完成度总表)；项目名为「肥鱼电台 FishFM」，仓库名为 `dsh-feiyuFM`；`DeepSeek Music Persona` 是产品定位，`SeekFM` 是早期讨论用名。尚未发布 npm 包。

Node 24.14～24.x 下可运行，**大部分检查不需要音乐账号**：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check        # 语法与模块检查
npm test             # 195 项离线测试
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
- 音乐核心与播放服务独立于可见窗口；隐藏、关闭或崩溃的悬浮窗不能带走它们。

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
