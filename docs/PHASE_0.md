# 技术验证方法与证据要求

更新：2026-10-07。保留 `PHASE_0.md` 路径供既有引用使用。本文维护实验问题和通过条件；不独立维护完成状态，任务及验收进度统一见 [开发路线](PROJECT_PLAN.md)。早期可执行探针保留在 [根 spikes](../spikes/README.md)，报告保留在 [docs/spikes](spikes/README.md)，当前采用的进程/接口方案见 [架构](ARCHITECTURE.md) 和 [控制契约](CORE_CONTRACT.md)。

## 验证清单

| ID | 要回答的问题与最小实验 | 证据入口 |
|---|---|---|
| P0-01 DSH | 按指定版本验证插件、真实事件、工具/命令、启动/退出；慢音乐工作不阻塞宿主，停用正确清理 | [早期探针](spikes/P0-01-dsh.md)、[官方桌面](spikes/U5-official-desktop.md)、[采集契约](spikes/N7-host-contract.md) |
| P0-02 网易云 | 用户授权后验证账号、来源导入、搜索、推荐、解析与真实播放/暂停/恢复/换曲；降级保留真实来源 | [接口探针](spikes/P0-02-netease.md)、[P3 闭环](spikes/P3-real-loop.md)、[N4 来源](spikes/N4-environment-profile.md) |
| P0-03 QQ | 独立完成同样的账号/导入/播放闭环，不因近期接口失败删除 QQ 范围；按用户指令暂缓真实接入 | [现有离线适配](spikes/P4-P5-platforms.md)，现场状态见开发路线 |
| P0-04 Playback | 真实音频验证独立进程、暂停/静音/曲终/重连、取消慢打开和所有者退出；平台资源另作生命周期核对 | [基础探针](spikes/P0-04-playback.md)、[P1](spikes/P1-playback.md)、[N19](spikes/N19-wpf-audio-warmup.md)、[N20](spikes/N20-review-fixes.md) |
| P0-05 UI | 当前产品使用 DSH 设置/主面板/shell.overlay；验证显示/隐藏/拖动/吸边、主题/窄屏/键盘，离开页面继续播放 | [原生窗历史探针](spikes/P0-05-desktop.md)、[U5](spikes/U5-official-desktop.md)、[U7](spikes/U7-phl-ui-motion.md)、[U8](spikes/U8-panel-layout.md) |
| P0-06 数据 | 迁移/重启、事务/去重、凭据位置、退出清理、脱敏与有效进度；不以密文存在推断账号有效 | [基础探针](spikes/P0-06-local-data.md)、[N1](spikes/N1-autonomous-accounting.md)、[N10](spikes/N10-feedback-reset.md) |
| P0-07 运行边界 | 用户命令优先、旧结果不覆盖暂停、多会话单队列；记录实际请求/上下文及计划内调用账本，不用合成计数充当真实验收 | [N0](spikes/N0-runtime-evidence.md)、[多会话](spikes/A08-sessions.md)、[N7](spikes/N7-short-run.md)、[A09 口径](spikes/N17-p1-retention-a09.md) |

登录由用户在平台完成授权，不收集明文 Cookie。推荐或来源可降级，但登录失败、音频失败不能算真实闭环通过。先测独立音频，再接平台资源，避免 Provider 和 Playback 互相等待。

P0-05 曾比较原生窗口/Tauri；这些是历史探针，不是当前安装要求。当前产品不交付独立桌面窗、托盘或多屏 DPI 映射。

## 结果的最小记录

有实际结果后新增对应报告并从索引链接，不创建空报告补号：

```text
ID / 日期 / 执行环境
状态：未开始 / 进行中 / 通过 / 降级通过 / 阻塞
宿主或仓库：来源 URL、版本或 commit
步骤：可复现命令、必要权限、输入
观察：实际事件/字段/能力、成功和失败场景
证据：脱敏日志、截图或输出的位置
结论：采用方案、降级范围、仍未证明的部分
影响：对应规格、契约、决策及验收项
```

复用第三方代码或素材另记文件范围、commit/版本、代码与素材许可及保留声明，集中更新 [第三方声明](../THIRD_PARTY_NOTICES.md)。对话中的许可/性能描述不是证据。

## 判定边界

接口与生命周期以真实宿主验证；规则与事务可用可复现的离线轨迹。模拟预览只能验证模拟交互；来源 API 返回可用 URL 不等于声音已播放；选中歌曲不等于形成有效经历。

真实运行需区分 synthetic/real、核对实例及持续进度，保留实际请求/账本与环境信息。一次播放、短时实验或引用审计不能替代 [MVP A09](MVP.md) 的连续两小时运行，也不能推出所有账号、权限或设备均兼容。

无法采集的指标保持 unknown，未验项继续列在开发路线，不用文档整理改变验收结论。
