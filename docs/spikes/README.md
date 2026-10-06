# 实现与实验记录索引

这些记录保留执行当时的环境、步骤、结果和未验范围。历史账号、版本、测试数量与性能不是实时状态；当前进度和生产加载边界统一见 [开发路线](../PROJECT_PLAN.md)，现行行为见 [MVP](../MVP.md) 与 [控制契约](../CORE_CONTRACT.md)。

N7/R2 的短跑或合成演练不能替代 A09 两小时验收；U3/U4 等 PHL 记录按其日期阅读；N19 的旧预热阈值以 [N20](N20-review-fixes.md) 后续复测为准。

## 自主听歌、推荐与后续修复

| 记录 | 主题 |
|---|---|
| [N0](N0-runtime-evidence.md) | N0 真实运行采集 |
| [N1](N1-autonomous-accounting.md) | N1 自主续播与成长记账 |
| [N2](N2-netease-discovery.md) | N2 网易云真实候选来源 |
| [N3](N3-discovery-cache.md) | N3 真实发现池 |
| [N4](N4-environment-profile.md) | N4 多来源输入与环境画像 |
| [N5](N5-seeded-recommendation.md) | N5 种子关系与本地推荐 |
| [N6](N6-recommendation-insights.md) | N6 推荐与成长说明 |
| [N7](N7-host-contract.md) | N7 宿主采集契约与真实长跑入口 |
| [N7](N7-short-run.md) | N7 本轮短跑与中断边界 |
| [N9](N9-transparent-persona.md) | N9 透明人格、选歌回复与 token 账本 |
| [N10](N10-feedback-reset.md) | N10 歌曲反馈与推荐偏好重置 |
| [N11](N11-model-playlist.md) | N11 模型具体推荐歌单与输入曲库清空 |
| [N12](N12-playlist-verification-fix.md) | N12 模型歌单核对修复 |
| [N13](N13-crash-recovery-and-verification-bound.md) | N13：Core 崩溃自愈与模型歌单核对预算修复 |
| [N14](N14-user-next-library-fallback.md) | N14：用户「下一首」在模型歌单无可播曲目时回退输入曲库 |
| [N15](N15-llm-discovery-filter.md) | N15：LLM 筛选的平台发现候选（探索池重排） |
| [N16](N16-p0-cache-track-graph.md) | N16：P0 两项优化——画像缓存与个人相似图 |
| [N17](N17-p1-retention-a09.md) | N17：P1——数据保留、A09 口径与悬浮条错误可见性 |
| [N18](N18-p2-progress-and-relations.md) | N18：P2——进度平滑与歌单生成的关系事实 |
| [N19](N19-wpf-audio-warmup.md) | N19：WPF 音频预热（播放/下一首慢的根因修复） |
| [N20](N20-review-fixes.md) | N20：项目检查发现的超时、筛选状态与预热问题 |

## 界面、认证与桌面验证

| 记录 | 主题 |
|---|---|
| [U1](U1-bridge.md) | U1 状态桥接与窗口位置（离线部分） |
| [U2](U2-panel.md) | U2 面板逻辑（`src/ui/panel.mjs`） |
| [U3](U3-dsh-settings.md) | U3：DSH 主界面音乐设置 |
| [U4](U4-quick-login.md) | U4：网易云快捷登录、导入与 DSH 悬浮音乐条 |
| [U5](U5-official-desktop.md) | U5 官方 DSH 桌面版适配 |
| [U6](U6-qr-login-repair.md) | U6 扫码授权失败：社区方案与真实验证 |
| [U7](U7-phl-ui-motion.md) | U7 PHL 风格 UI 与动效 |
| [U8](U8-panel-layout.md) | U8 主面板与设置布局优化 |
| [U9](U9-character-blend.md) | U9 原图背景融合 |
| [U10](U10-user-gif-cutout.md) | U10 用户 GIF 逐帧背景移除 |
| [U11](U11-mode-autonomy-restore.md) | U11：模式恢复声音与「今天停止」恢复入口修复 |
| [U12](U12-playback-dolls.md) | U12：本地播放动效开关、锅盖 GIF 与飞散玩偶 |

## 平台与音频基础

| 记录 | 主题 |
|---|---|
| [P0-01](P0-01-dsh.md) | P0-01 DSH 生命周期局部验证 |
| [P0-02](P0-02-netease.md) | P0-02 网易云接口：实测结果与扫码运行手册 |
| [P0-04](P0-04-playback.md) | P0-04 独立播放宿主基础验证 |
| [P0-05](P0-05-desktop.md) | P0-05 桌面工具链与窗口行为：实测记录 |
| [P0-06](P0-06-local-data.md) | P0-06 本地数据部分验证 |
| [P1](P1-playback.md) | P1 独立 Playback：实现与验证 |
| [P2](P2-netease.md) | P2 网易云适配器：实现与验证 |
| [P3](P3-real-loop.md) | P3 网易云首条真实播放闭环 |
| [P4](P4-P5-platforms.md) | P4 QQ 与 P5 双平台协调：实现与验证 |

## 环境、选择与成长

| 记录 | 主题 |
|---|---|
| [T1](T1-environment.md) | T1 用户环境与初始人格：实现与验证 |
| [T2](T2-selection.md) | T2 选歌与决策门控：实现与验证 |
| [T3](T3-growth.md) | T3 经历与成长：实现与验证 |

## DSH 适配

| 记录 | 主题 |
|---|---|
| [I1](I1-dsh-adapter.md) | I1 DSH 适配层：实现与验证 |

## 故障与运行观察

| 记录 | 主题 |
|---|---|
| [R1](R1-faults.md) | R1 故障与资源检查 |
| [R2](R2-soak.md) | A09 / R2 请求计数与长跑证据 |

## 专项验收

| 记录 | 主题 |
|---|---|
| [A08](A08-sessions.md) | A08 多 Session 不抢占 与 A06 Session 不覆盖长期偏好 |

## 附件与编号

[assets](assets/) 保存 U7 截图；[U10 GIF 元数据](U10-gif-metadata.json) 与 U10 的逐帧处理报告配套。N8 是 QQ 后续任务，没有独立实测报告；缺失编号不表示通过，也不创建空报告补号。

新增或重命名报告时同步此索引及引用它的规格/任务入口，保留稳定证据路径。返回 [文档索引](../README.md)。
