# U22 对话区左缘 ASCII 频谱背景带

更新：2026-10-28。范围：DSH 工作区对话区左缘约 56px 宽的 ASCII 频谱背景带、可见性偏好与验证边界。状态只维护在 [开发状态](../PROJECT_PLAN.md)，行为条目见 [MVP 第 5 节](../MVP.md)。

## 目标与参考

用户要求在工作区对话区的左缘放一条约 56px 宽（14×4）的 ASCII 频谱背景带（Spectrum Bars 的窄幅形态）：每行对应一个频段，横向柱体长度随振幅变化，低频在底、高频在顶，整体随歌曲律动；位置固定、不参与互动，作为对话区左缘的背景装饰。观感参考 [audioMotion-analyzer](https://github.com/hvianna/audioMotion-analyzer)、[butterchurn](https://github.com/jberg/butterchurn)、[kai-claw/soundscape](https://github.com/kai-claw/soundscape) 与经典 ASCII 滤镜（渲染亮度 → 字符集索引的 asciify 思路）。

只借鉴观感与算法思路，不复制代码：audioMotion 的对数分频、峰值保持与重力下落、快起慢落平滑；soundscape 的静默"呼吸"待机；asciify 的"按亮度选字符"映射。未引入 Three.js 或其他新依赖、素材，[第三方声明](../../THIRD_PARTY_NOTICES.md) 不因此变化。

## 数据来源边界

音频由原生宿主（Windows 为隐藏 STA PowerShell 中的 WPF `MediaPlayer`）播放，短期媒体 handle 只在 Provider→Playback 间传递，不进入 UI（见 [架构](../ARCHITECTURE.md)、[契约](../CORE_CONTRACT.md)）。网页端因此拿不到真实音频流或 FFT，也没有歌词数据流。细带使用**本地动画时钟**生成模拟律动，与玩偶动画"本地时钟而非 WPF 音频测量"的先例一致；界面和本报告都不把它描述为音频测量。

## 实现

- `src/ui/client/spectrum-bars.mjs`（纯逻辑）：种子化 PRNG（mulberry32，按曲目 `playInstanceId`／平台 ID 哈希，换曲换纹样）；低频基底高、高频基底低的分段基准与低频慢、高频碎的目标更新节奏；约 100 BPM 的固定律动脉冲只加强低频；按播放进度生成首尾稍低、中段更满的能量弧；快起（15/s）慢落（4.4/s）包络；峰值即时上升、保持 420 ms 后按重力下落；暂停时回落到缓慢"呼吸"基线。`renderSpectrumStrip` 把 64 个频段铺成横向 ASCII 柱：每行一个频段（低频在底），柱体从左侧生长，柱内字符沿长度由疏到密地映射到经典 ASCII 字符集（空格起、`$` 止的 67 级亮度梯度），悬空的峰值用最亮的 `$` 标记。
- `src/ui/client/spectrum-strip.mjs`（React 组件）：注册为 `shell.overlay` 的第二个条目（`id: fishfm.spectrum`，order 31）。CSS 固定在 overlay 左缘 348px（宿主未提供侧栏宽度 API，按常见侧栏宽度取近似值）、宽 56px、纵向铺满对话区；`pointer-events:none`、`aria-hidden`，不可拖动、不可聚焦，只作为背景装饰。完整动态走 `requestAnimationFrame`，轻量与系统减少动态走 160ms 节拍，关闭时预积分出静态呼吸基线；行列数按实际尺寸测量（8–64 行、约 10 列），行距随高度伸展铺满整列。面板打开时不渲染。
- `src/ui/client/controller.mjs`：仅保留 `fishfm.spectrum.visible.v1` 可见性偏好（默认开启），不保存位置、不进入 Core、RPC 或模型事实。`panel.mjs` 界面选项增加"背景频谱"开关。
- 预览 harness 渲染全部 `shell.overlay` 条目，并加"播放/暂停演示"。

## 验证

2026-10-28，Windows 10.0.22631 / Node 24.22.1：

- 单元／客户端测试：`test/spectrum-bars.test.mjs` 11 项（确定性重放与换种子、边界、峰值不低于柱体、静默回落、峰值保持后下落、频段数钳制、细带行宽／字符集／低频在底／密度单调／峰值尾随、能量弧、哈希与 PRNG），`test/dsh-client.test.mjs` 新增 3 项（默认显示与面板隐藏、偏好读写与恢复、设置开关）。全量 `npm test` 594 项通过、0 失败、0 跳过。
- 模拟浏览器（`preview:ui` + 本机 Chrome）：背景带位于 x=348、宽 56、高 935（铺满 overlay），`pointer-events` 为 `none`、无控件 role；播放时 64 行、每行 10 列、345 个可见字符、26 种不同字符；暂停后字符种类降到 2（呼吸基线）；拖动尝试后坐标不变（固定位置）；设置开关关闭后首页不再渲染、重新开启后恢复；控制台无错误。深浅两套主题截图检查通过（截图仅存本机 `work/`，未入库）。
- 过程中修复的真实缺陷：overlay 框架为 `pointer-events:none` 时早期版本的拖动手柄失效；首次挂载在面板内时不渲染，尺寸 effect 空依赖导致切回首页后不再测量（依赖改为面板与可见性）。当前版本不可交互，不再涉及该拖动路径。

## 未验与边界

- 真实 DSH 宿主（0.2.1-rc.2）对同槽位第二个条目的渲染未在隔离 profile 实测；若宿主只渲染一个条目，背景带会缺席而不影响播放。宿主侧栏宽度与固定 348px 的实际对齐同属未验；若宿主侧栏更宽或更窄，背景带可能偏离侧栏边缘若干像素。
- 未在 macOS、真实音频、长时间连续运行与读屏软件下验证；CPU 占用只有本机观察（每帧写一个 56px 宽的 `<pre>` 文本），不作性能承诺。
- 背景带是装饰性模拟，不反映真实声学能量，也不检测歌词或节拍；不接收任何输入，不影响播放与推荐。
