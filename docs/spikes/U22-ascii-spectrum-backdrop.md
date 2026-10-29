# U22 工作区背景 ASCII 频谱

更新：2026-10-29。范围：DSH 主工作区左缘的 ASCII 频谱背景层、挂载点调查、真实页面验证与音频数据边界。状态只维护在 [开发状态](../PROJECT_PLAN.md)，行为条目见 [MVP 第 5 节](../MVP.md)。

## 目标与参考

用户要求在 DSH 中央工作区最左侧（紧贴 Sidebar 右边界、位于对话正文左侧留白）制作一层随音乐律动的 ASCII 频谱背景：不是悬浮窗、卡片或播放器面板，不占布局，不拦截交互；参考 `ASCIIText`（像素亮度 → ASCII 字符集、波浪形变、等宽字符排版、ResizeObserver）的观感，但把视觉主体换成 ASCII Spectrum Bars。

只借鉴思路，不复制代码，不引入 Three.js。取舍：参考实现用 WebGL 渲染文字再逐帧回读像素做 asciify；本项目没有 3D 场景需求，直接用字符矩阵生成 ASCII 场更轻、更稳定——无 GPU 资源、无全屏 canvas、无逐帧 `getImageData`，并且天然纯 DOM/CSS，便于主题切换与卸载清理。字符集沿用参考代码的 72 级亮度梯度（空格 → `$`）。

## DSH 宿主调查（0.2.1-rc.3，本机 `D:\dsh`）

解包官方 `app.asar` 并核对布局与会话包源码（未修改宿主）：

- **框架结构**：`AppFrame` 三列 grid（侧栏 264–420px，默认 280px，收起 56px）＋ `shell.bottom` 行；`shell.overlay` 是覆盖整个框架的绝对定位层（`[data-shell-overlay]`，`z-index:20`，`pointer-events:none`，子元素默认 `auto`）。
- **可用插槽**：`main`（keyed 面板）、`conversation.content`（会话正文工厂）及其子槽（`conversation.session`、`composer`、`input.dock`、`hero.*`）、`shell.overlay`／`shell.bottom`／`shell.leading`、`sidebar.*`、`settings.*`。**没有任何背景类插槽**；`conversation.content` 本身由会话包注册为工厂，第三方无法安全地再挂一个背景条目（会进入会话布局、可能改变正文结构）。最小侵入且不改宿主的方案是继续使用 `shell.overlay` 条目。
- **稳定锚点**：会话正文容器带语义属性 `[data-conversation-content]`，覆盖整个中栏；输入卡片 `[data-composer-card]`（正文宽度 + 32px）；正文宽度手柄 `[data-width-handle="left"]`（仅活动会话渲染）；宿主在 Windows 下面板上发布 `--dsh-windows-sidebar-width`。`.an3WzG_*` 等类名是构建哈希，不可依赖。
- **结论**：背景层挂在 `shell.overlay` 的第二个条目（`id: fishfm.spectrum`），几何**运行时测量** `[data-conversation-content]` 推导：左缘＝中栏左边界（视觉上紧贴 Sidebar 右边），高度＝正文容器高度，宽度＝左缘留白内 `min(160px, gutter-12px)`；留白优先取宽度手柄右缘 + 24px，空会话退回输入卡片左缘 + 16px，再退回宿主正文宽度公式。目标消失（打开面板／无会话）即隐藏。不使用固定屏幕坐标，不挂 `document.body`，不改变正文宽度、输入框、滚动或 Sidebar 布局。

## 音频数据边界（重要）

真实 FFT **当前无法获取**，不是实现取巧：

- 音频由独立原生宿主进程播放（Windows：隐藏 STA PowerShell 中的 WPF `MediaPlayer`），播放 IPC 协议只有 `load/play/pause/stop/setMuted/snapshot/ping/shutdown` 命令与 `started/progress/ended/error/exiting` 事件，没有任何 PCM／频谱数据；短期媒体 handle 只在 Provider→Playback 间传递，按契约不进入 UI。
- 网页端没有 `<audio>` 元素，也没有 `AudioContext`（已核对 `src/ui`、`src/playback` 与真实页面），因此无法用 AnalyserNode 做 FFT；即便把网易云 CDN 直链交给网页解码，也违反“媒体 handle 不进 UI”的既有边界，且受 CORS 与二次流量限制。

因此当前视觉是**由真实播放状态驱动的本地模拟频谱**（播放/暂停/停止、曲目种子、播放进度能量弧、约 100 BPM 律动），界面与文档都标注“模拟律动，非音频测量”，不声称是真实频谱。要进入真实频谱阶段，需要宿主侧新增音频回环捕获（如 WASAPI loopback）并在播放协议中增加频谱事件与用户授权，属于跨进程与隐私范围的新工作，本轮未做。

## 实现

- `src/ui/client/spectrum-bars.mjs`（纯逻辑）：种子化 PRNG（mulberry32，按曲目 `playInstanceId`／平台 ID 哈希）；对数式低频高、高频低的分段基准与低频慢、高频碎的目标节奏；约 100 BPM 律动脉冲加强低频；播放进度能量弧；快起（15/s）慢落（4.4/s）包络；峰值保持 420ms 后按重力下落；暂停回落“呼吸”基线。
- `renderSpectrumField` 的观感在 2026-10-28 重做为**分层浪线海面**（原「竖向柱＋镜面倒影」已移除）：顶部浪脊即谱轮廓，每列浪高＝该频段能量、低频在左；下方逐层跟随轮廓、变平，行距按透视拉开；斜率给 `/` 与 `\` 字形（新增 `FIELD_WAVE`，不属于亮度梯度），断口按「浪段」成块出现而不是逐点抖动。笔画随深度从 `~`／`-` 过渡到 `'`／`.`；海的高度与浪段密度跟整体能量走——播放时铺满纵深，暂停后只剩贴近水线的几道浅纹。悬空峰值仍用最亮字符标出。
- `src/ui/client/spectrum-backdrop.mjs`：`SpectrumBackdrop` 组件。运行时测量见上节；`requestAnimationFrame` 驱动但限制在 12fps，`reduced` 240ms，`off`／系统减少动态时只画一帧静态呼吸基线；`ResizeObserver`（正文容器）+ `resize` + 800ms 低频巡检（目标挂载、宽度偏好变化）重算几何；卸载时取消 rAF、清理定时器与观察者。
- 计时修正（2026-10-28）：新增 `createSpectrumClock`／`createSpectrumDriver`。时钟只认真实时间，按固定步长 `SIM_STEP = 1/60` 结算，单次追赶上限 `MAX_CATCH_UP_S = 0.25` 秒；驱动层把步数喂给引擎并维护波浪相位。绘制频率（12fps／240ms／任意屏幕刷新率）只影响采样疏密，不再改变运动速度。修正前的实现每次 rAF 都刷新 `last`、只在跨过帧间隔时 `engine.step(dt)`，被丢弃的时间永久丢失——60Hz 屏幕上 4 秒真实时间只推进约 0.68 秒模拟（复核脚本给出的量化结果），轻量档同理更慢。
- 动画 effect 依赖收敛：只依赖“可见性＋动效档位”；播放状态与进度改走 ref，普通快照刷新（`revision` 递增）或网格尺寸变化不再重启循环，`reseed` 对相同种子返回 `false` 且不清空目标。页面隐藏时不推进模拟，`visibilitychange` 回到前台先 `reset` 丢弃空档再按当前时刻继续；网格变化只用最近一帧按新行列重画。
- 合成路径统一（2026-10-28 现场验收时修）：海面与鲸鱼共用 `composeField()`，动画帧与尺寸变化后的重画都走它。修正前 resize 分支只重画海水、不重画鲸鱼，改窗口宽度的瞬间鲸鱼会从画面里消失。`test/spectrum-backdrop.test.mjs` 已加断言固定这一点。
- 样式（`styles.mjs`）：定位与尺寸由内联几何给出；根元素 `pointer-events:none`、`aria-hidden`；无边框、无底色、无圆角、无阴影；`<pre>` 使用等宽字体、右侧 `mask-image` 渐隐（42% → 100%），浅色主题 `opacity:.17`、深色 `.32`、待机更低；`contain:strict` 限制重排影响。主题跟随宿主 `body[data-ds-dark-theme]`。
- `src/ui/client/controller.mjs`：仅 `fishfm.spectrum.visible.v1` 可见性开关（默认开启），不保存位置、不进入 Core/RPC/模型事实。设置页“界面选项 → 背景频谱”。
- 预览 harness 增加模拟侧栏与 `[data-conversation-content]`，保持与宿主 DOM 同构；另加「鲸鱼彩蛋」按钮，只在预览里把冷却与首次延迟置零（`whaleEager`），生产注册不传这个 prop。
- **鲸鱼彩蛋（2026-10-28）**：`src/ui/client/spectrum-whale.mjs`（纯逻辑，无 DOM、无自己的计时器）。字母格取自 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 的 `whaleFrames.ts`（MIT），原作为 [lhh010/dsh-ui-whale](https://github.com/lhh010/dsh-ui-whale) 的 40×25 手绘像素鲸鱼（BSD-3-Clause）；本项目只取 `standard`／`fin1`／`tail3`／`spout4` 四帧的"哪些格子有墨"轮廓，按包围盒块多数决降采样到 18×9，配色映射与全部渲染/状态机/合成代码重写，未复制上游调色板、ANSI 编码、Ink 组件或 `whaleGirl` 素材（授权与范围见 [第三方声明](../../THIRD_PARTY_NOTICES.md)）。
  - 状态机 `lurk → emerge → breach → dive → ripple`（共 5.3 秒）：`submerge` 从 0.82 降到 0.02 再回到 0.94，出水阶段依次换 `fin`／`tail`／`spout` 姿态；涟漪阶段身体已完全撤出，网格里只剩水面圈。
  - 触发是低频的：播放中每 10 秒掷一次 30% 的骰子，且距上次结束至少 `WHALE_COOLDOWN_S = 95` 秒、首次最早在 `WHALE_FIRST_DELAY_S = 28` 秒后；五分钟后平均不超过 1–3 次。
  - 彩蛋的"在听"判据比界面播放态更宽：`listening = connected && snapshot && !paused && !lastError && status !== 'idle'`。切歌时 Core 会短暂进入 `resolving`，界面因此掉出 `active`；若按界面播放态推进，每次换歌都会把冷却清零，彩蛋在真实播放中永远攒不够 95 秒（现场验收时量化复现：60 秒内 `data-active` 翻转 3 次，冷却被反复重置，330 秒内一次也没出现）。暂停、停止、出错、关闭动效仍然立即取消。
  - 合成方式：`stampWhale(grid, …)` 直接改写海水那张 `rows × cols` 字符数组——露出水面的格子用原字形（`@ % o -`），没入水下的换成更淡的影子（`' ,`），出水处两侧补浪花，涟漪从入水点向两侧扩。因此 DOM 里始终只有一个 `<pre>`，鲸鱼没有独立的浮层、Z 序或 mouse 事件。
  - 安全取消：暂停、停止、`motion != full`、面板打开、宽度不足 12 列、页面隐藏都会立刻 `cancel()` 并清掉当前视觉，不会留下半截鲸鱼。

## 验证

2026-10-28，Windows 10.0.22631 / Node 24.22.1：

- 单元／客户端：`test/spectrum-bars.test.mjs` 21 项。计时侧 6 项：采样率不改变运动、长空档按上限截断、`reset` 丢弃缓存空档、固定步长网格不漂移、同种子 reseed 为 no-op、帧快照不跟随活动缓冲；渲染侧按海面语义重写为「浪脊随能量抬升、水下逐层变稀、浪线连续（≥80% 墨点落在连续段、最宽浪段 ≥8 列）、浪脊高度与频段能量正相关（r>0.45）、安静时明显退潮、峰值标记与相位无关」，移除旧的「尖端更密／倒影更暗」镜面倒影断言。`test/spectrum-whale.test.mjs` 11 项（字符合法性与矩形网格、不同宽度缩放不畸变、窄网格跳过、暂停/减少动态不出场、五阶段顺序与时长、五分钟内出现次数上限、事件中途取消、合成只改同一网格、水上实体水下影子、涟漪在身体消失后仍画且不越界、越界时不动海水）；`test/spectrum-backdrop.test.mjs` 7 项源码契约（动画走驱动层且不再有逐帧 `dt`、动画 effect 只依赖可见性/动效档位/预览用的 `whaleEager`、种子只随曲目变、resize 只用最近一帧重画、鲸鱼与海水共用一个 `<pre>` 且鲸鱼模块无 DOM 与自有计时器、动画帧与 resize 共走 `composeField` 合成器、鲸鱼按"在听"判据而非瞬时界面播放态推进）。全量 `npm test` **622 项通过、0 失败、0 跳过**；171 模块检查与 `build:client` 通过。
- **真实 DSH 隔离 Web profile 重跑（2026-10-29，本次）**：同 N24 的启动方式（独立 `DSH_HOME`、`--profile fishfm-acceptance`、`--patch` 夹具、`dsh web` 打印的 launch URL 由浏览器完成 token→cookie 交换，RPC 走同源 `fetch`），账号与曲目全部是本地夹具，未接入任何真实平台。实测结果：
  - 会话正文 `x=280,y=40,w=1320,h=960`；背景层 `x=280,y=40,w=160,h=960`，左缘与高度都完全贴合。`pointer-events:none`、`background: rgba(0,0,0,0)`、`border: 0px`、`border-radius: 0px`、`box-shadow: none`、`data-ready=true`、`data-motion=full`。
  - 播放态 `data-active=true`，80 行字符场、516 个墨点、7 种字形，1.2 秒采样两次内容不同（确实在动）；`pre` 的 `opacity` 浅色 `0.17`、深色 `0.32`，与样式表一致。
  - **彩蛋默认节奏**：`data-whale` 在 **155 秒**首次报出 `lurk`，随后连续采到 `lurk → emerge → breach → dive → ripple` 五个阶段，事件结束后 `data-whale` 回到 `none`、字符场里不再有 `@`/`%`。鲸鱼所在的那一行同时含海面笔画（`~ - ' . \`），说明它写在同一张字符矩阵里而不是独立浮层。最终构建复跑一次同脚本：158 秒首现、五阶段齐全、结束后清空，`ISSUES: none`。
  - 窄窗口（900×900）：背景层返回 `null`（留白不足 `MIN_WIDTH=72` 时整层不渲染），正文容器 `x=56,w=844`，没有压到正文。
  - 合成宽度手柄注入后背景层仍为 `x=280,w=160`（夹具页面没有真实手柄，走的是输入卡片/公式回退分支），移除后不变。
  - 暂停后 `data-active=false`，墨点从 516 降到 147（明显退潮），且没有 `@`/`%` 残留。
  - 控制台无 error、无 pageerror。取证脚本 `work/dsh-whale-accept.py` 输出 `ISSUES: none`。
  - 视觉取证（`work/whale-visual-evidence.py`）：生产透明度 0.17／0.32 下截图中字符几乎不可见，为人工核对字形，脚本只在截图会话内注入 CSS 把 `pre` 提到不透明（不改源码、不改默认值）。对裁到背景层的图做像素统计：播放 4.5% 墨点、`lurk` 5.7%、`emerge` 5.4%、`breach` 7.4%、`dive` 7.8%（鲸鱼出水时墨点显著增加）、事件结束后回落 4.8%、暂停 2.2%。截图见 `work/vis-*.png`、`work/dsh-*.png`（未入库）。
  - 同时用 Node 复刻组件 tick 循环（`work/whale-loop-mirror.mjs`）核对节奏：固定种子下首次出现 168 秒、240 秒内 1 次事件、峰值 73 个鲸鱼字形；200 组种子下首现时间中位数 108 秒、p99 218 秒、最大 228 秒，没有一例超过 240 秒。这是"默认节奏在真实播放中多久遇到一次"的量化答案。
- 预览 harness（`work/spectrum-backdrop-check.py`，海面改版后重跑）：背景层 `x=280,y=65,w=160,h=935` 与正文容器左缘／高度完全一致；透明背景、0 边框、0 圆角、无阴影、`pointer-events:none`、`aria-hidden`；播放中 532 字符／8 种字形且逐帧变化、浪脊极差 18 行，暂停 6 秒后 146 字符、浪脊极差降到 3 行（明显退潮）。轻量档仍在动、关闭档静态且不再逐帧变化；窄窗口（900px）留白不足时整层隐藏不压正文；面板开关能卸载整层并恢复。`ISSUES: none`。截图见 `work/spectrum-{idle,playing,dark,paused,narrow,motion-off}.png`（未入库）。
- 预览 harness 的鲸鱼实测（同一脚本追加）：打开「鲸鱼彩蛋」后 14 秒内出现 2 次可截图的跃起/下潜画面，网格里出现 `@`／`%`／`o` 字形；暂停后 0.9 秒内这些字形全部消失，没有残留半截鲸鱼。截图见 `work/spectrum-whale-{1,2}.png`（未入库）。
- 计时修正的量化复核：旧实现 60Hz 屏幕上 4 秒真实时间只推进约 0.41–0.68 秒模拟（取决于节流边界）；新驱动在 12／60／144Hz 三种采样下同一时刻的相位与频段值完全相同。

## 未验与边界

- 未重启日常 Desktop 实例（用户正在使用，且期间发生过一次误杀，见下）；真实桌面窗口、多显示器/DPI 缩放、macOS 未验。隔离 Web profile 与桌面 renderer 共用同一客户端代码，但不等同桌面现场验收。
- **2026-10-29 操作事故**：验收脚本早期版本用 `taskkill /F /IM "DeepSeek Harness.exe"` 收尾，按镜像名结束了本机全部 DSH 进程，连带终止了用户正在使用的日常 Desktop 实例（日常 `core.json` 的 runId 从 `5cc22924`（13:52 启动）跳到 `73ca648f`（14:17–14:33结束）后无进程残留）。事后核对：日常库 `integrity_check ok`、18 张表、无 `acceptance-*` 夹具污染、当日无新增 `listen_history`。脚本已改为只按 Popen 返回的 PID 结束进程树（`taskkill /PID <pid> /T /F`）。
- 计时修正与本次现场验收都在隔离 Web profile 完成；真实桌面上的 12fps 表现、后台标签恢复与不同刷新率显示器仍需复核。
- 活动会话中出现真实宽度手柄时的测量分支只做了合成手柄验证；长会话、右侧栏打开、全屏等组合未逐一实测。
- 未做长时间 CPU/内存观测；背景层限制在 12fps、约 1.5k 字符（比柱状版更疏），无 GPU 资源，但没有性能承诺。
- 真实桌面观感、不同 DPI／窗口宽度下的浪线密度、以及鲸鱼在真实会话滚动位置下的观感仍未由用户主观确认；本次只做了隔离环境下的程序化取证。
- 鲸鱼触发概率与冷却在隔离宿主里用默认参数实测到 155 秒首现；不同曲目种子下的长期节奏由 `work/whale-loop-mirror.mjs` 与单元测试覆盖，未做多小时连续观察。
- 鲸鱼复用上游轮廓属衍生作品，已按 BSD-3-Clause 记录来源与许可；未做与上游字节级的逐帧比对，只保证字母格是同一形状的降采样。
- 真实 FFT 未实现（阻碍见上）；当前频谱不反映真实声学能量，不检测歌词或节拍。

## 后续阶段

- 第二阶段（ASCII 海面）**已完成**：`renderSpectrumField` 改为分层浪线，保留 `shell.overlay` 挂载与真实正文 DOM 定位，未引入 Three.js／WebGL 或新的运行时依赖，字符预算与 CPU 不高于柱状版。
- 第三阶段（鲸鱼彩蛋）**已完成**：字母格取自 dsh-TUI 的像素鲸鱼帧并降采样到 18×9，与海面写入同一张字符矩阵（DOM 里仍只有一个 `<pre>`，无贴图、无 emoji、无第二层浮层）；低频触发＋95 秒冷却、窄网格跳过、暂停/停止/关闭开关/减少动态立即取消。授权、版本与文件范围已记入 [第三方声明](../../THIRD_PARTY_NOTICES.md)。
- 第四阶段（视觉验收）**已完成程序化部分**：在真实隔离 DSH 环境采到浅色/深色、播放/暂停、鲸鱼五个阶段、窄窗口的截图与坐标/像素证据，控制台无错误。遗留：用户本人对真实桌面观感的确认，见 [未验与边界](#未验与边界)。
