# 项目协作规则

本文件只维护稳定的协作约束与事实入口；部署、测试数量和待验项只在 PROJECT_PLAN 更新。

## 开发与交接

- 用户指定日常直接在 `main` 开发；跨设备串行接续，工作区干净时先 `git pull --ff-only`。每项完成任务独立提交并推送 `main`，保持检查、测试和构建可运行。
- 提交保留 `feat:`、`fix:`、`docs:` 等英文类型前缀，标题与说明使用简体中文，技术标识与代码名称保留原文。
- 修改行为同步产品规格和验收条目；修改接口同步契约；改变既有决策记录理由、修订关系与证据，不复制多份完整规格或进度表。

## 事实与维护入口

| 内容 | 唯一维护入口 |
|---|---|
| 源码／发布／日常 Desktop、测试基线、验收缺口与下一步 | [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) |
| 用户行为与 A01–A10 标准 | [docs/MVP.md](docs/MVP.md) |
| 模块职责／数据流、内部命令／RPC／存储 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/CORE_CONTRACT.md](docs/CORE_CONTRACT.md) |
| 取舍、文档导航、文件／脚本位置 | [docs/DECISIONS.md](docs/DECISIONS.md)、[docs/README.md](docs/README.md)、[docs/REPOSITORY.md](docs/REPOSITORY.md) |
| 原始设计、实测证据、发行确认、旧记录 | [design](docs/design/README.md)、[spikes](docs/spikes/README.md)、[releases](docs/releases/README.md)、[archive](docs/archive/README.md) |

`src/ui/client/` 是界面维护源；`src/ui/dsh-client.js` 是受 Git 管理的生成 bundle，改后运行 `npm run build:client` 或 `npm run build` 并同步提交。运行素材唯一位置为 `src/ui/assets/`，预览复用生产资源路由，不复制到原型目录；来源、hash 与许可按 [第三方声明](THIRD_PARTY_NOTICES.md) 和对应报告核对。根 `spikes/` 是早期可执行探针，`docs/spikes/` 是报告。

## 实现与验证边界

- 默认 `filtered`：参考歌曲 → 网易云候选 → LLM 筛选 → 本地播放，自动播放只取入选曲；旧数据和内部兼容保留，见 [N22](docs/spikes/N22-platform-first-recommendations.md)。用户指定 QQ 暂缓，优先网易云与 UI，保留 QQ 代码及双平台范围；Last.fm 需用户 key，未开工。
- Provider 管平台、Playback 管音频、Core 管队列和决策；可见页面不能是播放服务唯一宿主。先验证 DSH 真实接口再适配，内部事件名不能当作宿主已提供的 API。
- 用户命令优先，暂停不能被自动事件撤销；用户约束与 Agent 长期偏好分开保存。中断恢复保持每实例原曲一次预算、暂停／换曲可取消。
- 逐曲执行不新增 LLM 请求，不逐轮注入音乐状态。计划内总结／歌单／筛选共用预算、门控和账本；手动筛选已取消模型冷却，后台自动筛选仍限频，精确规则见契约。
- U12/U13 彩蛋保持无文字、无悬停说明的左右开关，默认关闭并同步本机偏好；GIF／静态图／六张 doll PNG 随包提供，许可边界不变。
- 两小时连续观察已由用户 2026-10-16 取消，不恢复、不记为通过。离线回归、模拟浏览器、隔离安装和日常原生 Desktop 分别记录，不能相互代替；未采集用 `unknown`，未验仍写未验。
- 用户 2026-10-18 明确以 DSH 插件为交付和验证对象，日常 Desktop 部署不作为功能开发前置；宿主验证优先使用隔离 DSH profile，并单列安装、启用、RPC 与生命周期结果。
- 不提前创建空代码包、安装依赖或承诺未经实测的兼容性、性能和许可。第三方复用先记来源／版本／文件范围／许可；凭据、音频和运行数据库不入库。
