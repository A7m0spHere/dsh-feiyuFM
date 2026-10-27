# U22 首页 ASCII 频谱律动条

更新：2026-10-28。范围：DSH 工作区首页侧栏旁的 ASCII 频谱柱、本机偏好与验证边界。状态只维护在 [开发状态](../PROJECT_PLAN.md)，行为条目见 [MVP 第 5 节](../MVP.md)。

## 目标与参考

用户要求在工作区首页侧栏右侧的窄竖带内做一个随歌曲律动的 ASCII 频谱柱（Spectrum Bars），侧向排布（频段自上而下堆叠、柱体横向生长），参考 [audioMotion-analyzer](https://github.com/hvianna/audioMotion-analyzer)、[butterchurn](https://github.com/jberg/butterchurn) 与 [kai-claw/soundscape](https://github.com/kai-claw/soundscape)。

只借鉴观感与算法思路，不复制代码：audioMotion 的对数分频、峰值保持与重力下落、快起慢落平滑；soundscape 的静默"呼吸"待机与能量分层；butterchurn 的能量驱动思路。项目未新增第三方依赖或素材，[第三方声明](../../THIRD_PARTY_NOTICES.md) 不因此变化。

## 数据来源边界

音频由原生宿主（Windows 为隐藏 STA PowerShell 中的 WPF `MediaPlayer`）播放，短期媒体 handle 只在 Provider→Playback 间传递，不进入 UI（见 [架构](../ARCHITECTURE.md)、[契约](../CORE_CONTRACT.md)）。网页端因此拿不到真实音频流或 FFT，也没有歌词数据流。频谱条使用**本地动画时钟**生成模拟律动，与玩偶动画"本地时钟而非 WPF 音频测量"的先例一致；界面和本报告都不把它描述为音频测量。

## 实现

- `src/ui/client/spectrum-bars.mjs`（纯逻辑）：种子化 PRNG（mulberry32，按曲目 `playInstanceId`/平台 ID 哈希，换曲换纹样）；低频基底高、高频基底低的分段基准与低频慢、高频碎的目标更新节奏；约 100 BPM 的固定律动脉冲只加强低频；按播放进度生成首尾稍低、中段更满的能量弧；快起（15/s）慢落（4.4/s）包络；峰值即时上升、保持 420 ms 后按重力下落；暂停时回落到缓慢"呼吸"基线。ASCII 渲染用 `█` 主体、`▏▎▍▌▋▊▉` 八分块尖端表达亚字符精度、`▒` 标峰值；低频在底、高频在顶。
- `src/ui/client/spectrum-rail.mjs`（React 组件）：注册为 `shell.overlay` 的第二个条目（`id: fishfm.spectrum`，order 31）。完整动态走 `requestAnimationFrame`，轻量与系统减少动态走 160 ms 节拍，关闭时预积分出静态呼吸基线；行数按高度测量（8–64 段），行距随高度伸展铺满竖带，列数按实测等宽字符宽度计算。默认距 overlay 左缘 348 px（宿主未提供侧栏宽度 API，不猜宿主 DOM），可左右拖动或方向键微调，位置写入本机偏好并在窗口缩窄时收回可见范围。面板打开时不渲染；`aria-label` 说明状态与"模拟律动，非音频测量"。
- `src/ui/client/controller.mjs`：`fishfm.spectrum.visible.v1`（默认开启）与 `fishfm.spectrum.left.v1` 两个本机偏好，不进入 Core、RPC 或模型事实。`panel.mjs` 界面选项增加同名开关。
- 预览 harness 改为渲染全部 `shell.overlay` 条目，并加"播放/暂停演示"。

## 验证

2026-10-28，Windows 10.0.22631 / Node 24.22.1：

- 单元／客户端测试：`test/spectrum-bars.test.mjs` 10 项（确定性重放与换种子、边界、峰值不低于柱体、静默回落、峰值保持后下落、频段数钳制、ASCII 行宽／尖端／峰值标记、低频在底、能量弧、哈希与 PRNG），`test/dsh-client.test.mjs` 新增 3 项（默认显示与面板隐藏、偏好读写与恢复、设置开关）。全量 `npm test` 593 项通过、0 失败、0 跳过。
- 模拟浏览器（`preview:ui` + 本机 Chrome）：首页竖带位于 x=348、宽 76、高 899，条内 64 行；播放时 300 个 `█`、暂停后回落到 17 个（呼吸基线）；拖动后 `fishfm.spectrum.left.v1` 持久化为 468；设置开关关闭后首页不再渲染、重新开启后恢复；控制台无错误。深浅两套主题截图检查通过（截图仅存本机 `work/`，未入库）。
- 本轮发现并修复两处真实缺陷：overlay 框架为 `pointer-events:none` 导致拖动失效（组件补 `pointer-events:auto`）；首次挂载在面板内时不渲染，尺寸 effect 空依赖导致切回首页后不再测量（依赖改为面板与可见性）。

## 未验与边界

- 真实 DSH 宿主（0.2.1-rc.2）对同槽位第二个条目的渲染未在隔离 profile 实测；若宿主只渲染一个条目，频谱条会缺席而不影响播放。宿主侧栏宽度与默认 348 px 的实际对齐同属未验，靠拖动兜底。
- 未在 macOS、真实音频、长时间连续运行与读屏软件下验证；CPU 占用只有本机观察（每帧写一个 `<pre>` 文本），不作性能承诺。
- 频谱是装饰性模拟，不反映真实声学能量，也不检测歌词或节拍；不接收点击（仅拖动与键盘），不影响播放与推荐。
