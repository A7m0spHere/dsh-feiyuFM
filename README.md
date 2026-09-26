# 肥鱼电台 FishFM · dsh-fishfm

给正在 DSH 里工作的 DeepSeek 一副耳机。

从用户近期常听的音乐建立成长环境，由本地策略形成 Agent 的音乐偏好、记忆和自主选择；用户始终保留播放控制权。v0.1 同时支持网易云音乐和 QQ 音乐，桌面悬浮窗可随时隐藏。

**当前状态：文档与技术验证准备阶段，尚无可运行插件。** 项目名为「肥鱼电台 FishFM」，仓库名为 `dsh-fishfm`；`DeepSeek Music Persona` 是产品定位，`SeekFM` 是早期讨论用名。当前没有插件安装、启动或测试命令，尚未发布 npm 包。

这是独立维护的 DSH 社区项目，名称呼应 DeepSeek 大肥鱼形象；与大肥鱼插件的关系是实现参考，不要求安装该插件。

## 阅读入口

| 文档 | 用途 |
|---|---|
| [开发路线](docs/PROJECT_PLAN.md) | 阶段任务、前置依赖、交付条件、验收映射与跨设备交接 |
| [MVP 产品规格](docs/MVP.md) | 范围、用户行为、默认设置与验收标准 |
| [技术架构](docs/ARCHITECTURE.md) | 模块职责、播放生命周期、数据与事件边界 |
| [Phase 0 验证清单](docs/PHASE_0.md) | 开发前必须验证的接口和最小实验 |
| [决策与参考线索](docs/DECISIONS.md) | 对话来源、取舍、待验证项目与本次整理记录 |

## 项目约束

- 自动选歌、探索、状态同步和偏好更新在本地完成；两小时自动听歌新增 LLM 请求数必须为 0。
- 音乐不得阻塞 DSH 的任务、工具、构建和测试。
- 用户音乐环境与 Agent 偏好分开保存，用户命令优先于自主选择。
- 两个平台的适配器由项目维护，参考社区实现，不强制依赖其他 DSH 音乐或桌宠插件。
- 音乐核心与播放服务独立于可见窗口；隐藏、关闭或崩溃的悬浮窗不能带走它们。

接口、技术栈和第三方能力尚待验证；文档中的设计不代表功能已经实现。下一步按 [Phase 0](docs/PHASE_0.md) 验证 DSH 接入、双平台真实播放与桌面进程边界。

## 跨设备开发

公开仓库：[A7m0spHere/dsh-fishfm](https://github.com/A7m0spHere/dsh-fishfm)。新设备克隆后，让开发 Agent 先读取根目录 `AGENTS.md` 和项目规划。

```sh
git clone https://github.com/A7m0spHere/dsh-fishfm.git
cd dsh-fishfm
```

每次开始工作前，在工作区干净时同步；独立工作使用单独分支：

```sh
git switch main
git pull --ff-only
git switch -c codex/your-task
```

完成后提交本次相关文件并推送分支。在另一台设备继续同一任务时，先 `git fetch origin`，再切换对应分支并 `git pull --ff-only`。未提交的本地改动不会跨设备同步，推送需要有仓库写权限的 GitHub 账号。

账号凭据、Cookie、运行数据库和音频文件留在各设备本地，不通过仓库同步。
