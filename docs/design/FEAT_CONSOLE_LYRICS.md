# 控制台歌词显示方案

调研日期：2026-11-05。本文记录用户截图对应的布局提案、社区选型和实现步骤；任务状态只维护在 [PROJECT_PLAN](../PROJECT_PLAN.md)。尺寸、接口名和默认选项是建议，不是已经实现的产品契约。

## 1. 目标与首版边界

在 DSH 肥鱼电台主面板的「正在听」页显示当前歌曲歌词。歌词位于用户截图红框所示的右侧，左侧人物缩小并收紧占位，歌曲信息、喜欢／少推荐和「大肥鱼说」保留，底部控制始终可用。

优先网易云，复用平台曲目 ID 精确取词。首版不扩展到桌面悬浮歌词、其他页面／平台、歌词编辑器或歌词深度分析；歌词不进入模型提示词，不用 LLM 生成、翻译或补造时间戳。普通歌词不能假装具备真实逐字时间。

三项需求已在对话中询问；未回答时仅保留下列建议，不把建议视为已确认需求：

| 项目 | 暂定建议 | 对实现的影响 |
|---|---|---|
| 高亮方式 | 逐行滚动，当前句高亮 | 可先覆盖普通 LRC；逐字需增加 YRC 解析和更细的本地动画时钟 |
| 翻译／音译 | 原文＋已有中文翻译，音译按需开启 | 只显示平台实际提供的内容；无翻译不留空白副行 |
| 点击歌词跳转 | 首版先显示；待确认是否同时做跳转 | 现有进度条不可拖动，也没有公开 seek 命令，需要增加播放控制能力 |

## 2. 布局与交互

桌面宽屏采用三列，按控制台实际可用宽度布局：

```text
┌────────────┬───────────────────┬──────────────────────────┐
│            │ 播放状态          │ 歌词             翻译开关 │
│  紧凑人物  │ 歌名／歌手        │ 上一句                    │
│            │ 喜欢／少推荐      │ 当前句高亮                │
│ 无文字开关 │ 大肥鱼说          │ 下一句                    │
│            │ 展开选歌依据      │ 后续歌词，可手动滚动      │
└────────────┴───────────────────┴──────────────────────────┘
│ 大肥鱼可选的歌                                            │
├──────────────────────────────────────────────────────────┤
│ 当前歌曲        上一首／播放暂停／下一首          声音开关 │
└──────────────────────────────────────────────────────────┘
```

- 内容宽度约 ≥960px：人物列约 160–180px，信息列约 260–300px，歌词取得剩余空间，目标至少约 340px；人物图宽约 150–170px，保持完整比例。现有图最大 224×250px，主要压缩人物列占位和留白。
- 约 640–959px：人物与信息合并为左侧紧凑区，歌词仍在右侧；两边不能保持可读宽度时提前改为上下布局。
- 约 <640px：人物和歌曲信息在上，歌词独占一行；极窄容器减少人物占位，歌词正常换行，不产生横向滚动。断点在实际 DSH 容器中调整。
- 歌词区建议高约 300–360px，低高度窗口降至约 220–260px；区域内滚动，不让全文拉长页面。当前句靠近中上部，周围保留上下文，不自动滚动整个页面。
- 沿用现有浅／深色和蓝色强调色；当前句加深或变色，其他句保持可读，不用强模糊或过多缩放。处理长句换行、双语副行和间奏。
- 用户手动滚动时暂停跟随，显示「回到当前句」；点击恢复跟随。暂停保持当前句，切歌清空旧词并取消旧请求。
- 加载中、无歌词、纯音乐、仅无时间戳文本、请求失败分别呈现。只有明确数据支持才标为纯音乐；无时间戳文本可浏览，不伪造同步。失败可重试，不影响播放。
- 支持键盘浏览和系统减少动态效果，逐句变化不持续触发 aria-live。保留现有人物彩蛋无文字、无悬停说明的小开关。

## 3. 社区调研与选型建议

已核对上游 README、package.json、许可原文及 npm registry 元数据，未安装候选依赖、复制代码或运行 demo。下表版本是调研时 registry 公布的版本；后文源码 HEAD 不直接视为 npm 发布包对应提交，采用前需对齐包内容与来源。

| 候选 | 已核对能力与许可 | 本项目适用性 |
|---|---|---|
| [AMLL](https://github.com/amll-dev/applemusic-like-lyrics)：core@0.6.0、lyric@1.1.0 | DOM／React／Vue 绑定，逐字、翻译、音译、滚动、对唱；解析包支持 LRC／YRC 等；两包均为 AGPL-3.0-only | 完整歌词效果的主要候选。需处理构建、样式、依赖和许可分发要求；只评估歌词模块，不引入完整播放器或背景 |
| [lrc-kit](https://github.com/weirongxu/lrc-kit)：1.2.1 | MIT；普通／增强 LRC 解析，外部时间驱动的 Runner；未发现原生 YRC 支持声明 | **逐行首版优先候选**：后端解析并输出统一时间轴，现有 React／CSS 渲染，不改客户端打包方式。排序、offset 和翻译对齐由适配层处理 |
| [lrc-file-parser](https://github.com/lyswhut/lrc-file-parser)：2.4.2 | MIT；LRC 解析、扩展歌词合并、播放／暂停、offset；文档默认 offset 为 150ms | 双语 LRC 备选；需避免内部计时与现有播放进度形成两个时钟，不能无意套用 150ms 偏移 |
| [Liricle](https://github.com/mcanam/liricle)：4.2.0 | MIT；普通／增强 LRC，外部 sync(time) 驱动，输出当前行和词 | 轻量同步备选；不是完整渲染组件，YRC 和双语对齐仍需适配 |

推荐「现有网易云词源＋后端解析／规范化＋本地歌词组件」。逐行需求先验证 lrc-kit；若用户重视完整逐字动效，再与 AMLL 做针对性比较。AGPL 与 MIT 是核对的包许可标记，实际复用范围和分发安排在选型时落实，不提前锁依赖。

源码快照和拟复用文件范围：

- AMLL HEAD 6911611dd2f0fbd621d95a594ae048fd3474bab8：[core README](https://github.com/amll-dev/applemusic-like-lyrics/blob/6911611dd2f0fbd621d95a594ae048fd3474bab8/packages/core/README.md)、[core package](https://github.com/amll-dev/applemusic-like-lyrics/blob/6911611dd2f0fbd621d95a594ae048fd3474bab8/packages/core/package.json)、[lyric package](https://github.com/amll-dev/applemusic-like-lyrics/blob/6911611dd2f0fbd621d95a594ae048fd3474bab8/packages/lyric/package.json)、[LICENSE](https://github.com/amll-dev/applemusic-like-lyrics/blob/6911611dd2f0fbd621d95a594ae048fd3474bab8/LICENSE)。仅候选渲染／格式解析模块。
- lrc-kit HEAD dd4c7cf7efdca642ad2424060ec3b47dbbdb468f：[README](https://github.com/weirongxu/lrc-kit/blob/dd4c7cf7efdca642ad2424060ec3b47dbbdb468f/README.md)、[package](https://github.com/weirongxu/lrc-kit/blob/dd4c7cf7efdca642ad2424060ec3b47dbbdb468f/package.json)、[LICENSE](https://github.com/weirongxu/lrc-kit/blob/dd4c7cf7efdca642ad2424060ec3b47dbbdb468f/LICENSE)。候选 Lrc.parse，不需要生成器或前端 Runner。
- lrc-file-parser HEAD 5d46a48573d105fdbdbfbe9258e57ee8fdf1d2f2：[README](https://github.com/lyswhut/lrc-file-parser/blob/5d46a48573d105fdbdbfbe9258e57ee8fdf1d2f2/README.md)、[package](https://github.com/lyswhut/lrc-file-parser/blob/5d46a48573d105fdbdbfbe9258e57ee8fdf1d2f2/package.json)、[LICENSE](https://github.com/lyswhut/lrc-file-parser/blob/5d46a48573d105fdbdbfbe9258e57ee8fdf1d2f2/LICENSE)。候选解析／翻译合并能力。
- Liricle HEAD 2cc1e3fe367bfc4550d0a91144d0efb47bd230a8：[README](https://github.com/mcanam/liricle/blob/2cc1e3fe367bfc4550d0a91144d0efb47bd230a8/README.md)、[package](https://github.com/mcanam/liricle/blob/2cc1e3fe367bfc4550d0a91144d0efb47bd230a8/package.json)、[LICENSE](https://github.com/mcanam/liricle/blob/2cc1e3fe367bfc4550d0a91144d0efb47bd230a8/LICENSE)。候选解析／外部时间同步能力。

仓库已锁定 @neteasecloudmusicapienhanced/api@4.40.1，本地包与[上游 lyric_new](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/lyric_new.js)均包含歌词调用；普通 lyric 请求 /api/song/lyric，lyric_new 请求 /api/song/lyric/v1。**模块存在不等于真实歌曲具备歌词／逐字数据**；响应字段、翻译覆盖、登录要求和失败行为仍需取样。歌词来源仍是网易云，开源解析／渲染项目不会自动补齐词源。

## 4. 现有代码与拟接入方式

| 现有入口 | 核对结果／计划改动 |
|---|---|
| src/ui/client/panel.mjs、styles.mjs | 当前人物与歌曲说明为两列，改为紧凑陪伴区＋歌词区 |
| components.mjs 的 useSmoothProgress、presentation.mjs | 已按 playInstanceId 锚定进度，约 500ms 本地刷新；逐行可先复用。逐字需局部动画更新，避免每帧重渲染整个面板 |
| src/providers/netease.mjs、platform.mjs | 社区调用白名单未接歌词。Provider 增加可取消的取词读取和能力声明；QQ 返回不支持 |
| Core／RPC／客户端 controller | 新增独立只读路径，全文不塞入每次播放快照，不排队阻塞暂停／下一首 |
| scripts/client-bundle.mjs | 当前仅拼接本地模块，外部只允许 React；后端解析＋本地 UI 可保留构建。AMLL 需另验依赖打包与 CSS |
| src/playback/protocol.mjs、src/contracts.mjs | 宿主命令和用户命令均无 seek；点击跳转需扩展 Core、播放服务及 WPF／macOS 能力与降级 |

建议数据流：当前曲目变化 → 独立歌词读取 → Provider 按 providerTrackId 取词 → 后端解析／合并／缓存 → UI 以真实播放进度投影。取词或解析失败不阻塞媒体加载，不新增逐曲模型请求或额外进度 RPC 轮询。

拟议只读接口 fishfm/lyrics 输入曲目键，输出曲目键、来源、格式、状态和规范化行；实施时同步 [CORE_CONTRACT](../CORE_CONTRACT.md)。统一使用毫秒，每行含稳定 ID、startMs/endMs/text，翻译／音译可选；words[{startMs,endMs,text}] 仅在词源提供真实时间时存在。无同步文本单独保留，不补虚假时间。

UI 用曲目键＋独立请求代次去旧，播放投影另绑定 playInstanceId。同曲再次播放复用词，但从新实例进度重新定位；取消后迟到回包不覆盖新歌。账号切换／退出按账号代次失效，不向 UI 返回凭据或原始平台响应。

先做有界内存缓存，不新增数据库迁移：建议最多 100 首、成功缓存 24 小时、无词短缓存约 10 分钟；网络／账号失败不作为无歌词缓存，限制正文／行数和并发，参数随取样调整。面板隐藏时停歌词动画和新请求，音频继续由独立服务播放，重开从快照和缓存恢复。

原文／翻译／音译按时间对齐，不按数组下标硬拼；处理多时间标签、同时间多行、空行／间奏。校验排序、offset、异常标签，以纯文本渲染，不解释歌词中的 HTML。首版暂不加偏移调节器，先测真实同步误差。

若做点击跳转：以真实宿主 seek 成功为准，以实例和命令版本防止误跳新歌；暂停时跳转后仍暂停，跳过的时间不计有效收听，不新增播放开始或占用最近 50 次窗口。需修订现有只向前的进度投影，允许 seek 应答位置后退；不能只移动歌词，也不能重载整首冒充无缝跳转。宿主不支持时禁用跳转，显示仍可用。

## 5. 实施顺序与通过条件

1. **验证词源并锁定方案**：普通中文、外语带翻译、逐字、纯音乐／无词少量取样，记录格式、字段存在性、耗时和失败类别，不提交歌词全文或账号信息。比较解析输出，采用时锁版本并补来源、文件范围、许可和随包声明。
2. **验证布局**：用现有生产预览做占位，核对截图约 1200px、960／740／560／440px 容器及极窄／低高度、浅深色、长标题／长句。确定人物占位和歌词阅读宽度后接数据，不另造运行页面。
3. **接数据与逐行显示**：独立读取、规范化、缓存、去旧、定位、跟随／手动浏览、双语和异常状态；同步 MVP／契约／决策，重建受 Git 管理的 bundle。
4. **按用户选择扩展**：逐字需验证 YRC、局部动画开销及降级；点击跳转需实现真实宿主 seek。若首版要求它们，就纳入首版通过条件，不以逐行显示替代交付。
5. **分层验收**：相关离线回归及必要检查，浏览器预览，官方隔离 DSH profile 的安装／RPC／生命周期和真实网易云同步验证。日常 Desktop／macOS 真机未验时单列，发布另行安排。

关键验收场景：

- 当前句随音频变化，暂停停止推进，恢复不归零；切歌、连点下一首和返回历史不串词。
- 有／无／错位翻译、长句、同时间多行、间奏、负 offset、畸形文本合理处理；缺数据按实际降级。
- 迟到请求、超时、重试、退出登录、重连、面板隐藏／显示不恢复暂停、不阻塞播放控制。
- 底部控制可达，歌词只滚动自身，手动浏览能返回跟随；人物完整、小开关可用、窄容器不溢出。
- 逐行建议以真实音频进度为基准，当前句切换偏差约 ≤500ms 作为验证起点；这是验收建议，未作实测承诺。逐字目标随词源和宿主实测制定。
- 首轮只取当前曲，不预取整个候选池；缓存命中不重复取词，渲染不额外轮询，新增模型请求为 0。同步与资源测量分别记录。

返回 [设计索引](README.md)。
