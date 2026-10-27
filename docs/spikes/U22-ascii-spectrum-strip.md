# U22 对话区左缘 ASCII 频谱细带

更新：2026-10-28。范围：DSH 工作区对话区左缘约 14px 宽的 ASCII 频谱细带、本机偏好与验证边界。状态只维护在 [开发状态](../PROJECT_PLAN.md)，行为条目见 [MVP 第 5 节](../MVP.md)。

## 目标与参考

用户要求在工作区对话区的左缘放一条约 14px 宽的 ASCII 频谱律动细带（Spectrum Bars 的极窄形态）：每行对应一个频段，字符密度随振幅变化，低频在底、高频在顶，整体随歌曲律动。观感参考 [audioMotion-analyzer](https://github.com/hvianna/audioMotion-analyzer)、[butterchurn](https://github.com/jberg/butterchurn)、[kai-claw/soundscape](https://github.com/kai-claw/soundscape) 与经典 ASCII 滤镜（渲染亮度 → 字符集索引的 asciify 思路）。

只借鉴观感与算法思路，不复制代码：audioMotion 的对数分频、峰值保持与重力下落、快起慢落平滑；soundscape 的静默"呼吸"待机；asciify 的"按亮度选字符"映射。未引入 Three.js 或其他新依赖、素材，[第三方声明](../../THIRD_PARTY_NOTICES.md) 不因此变化。

## 数据来源边界

音频由原生宿主（Windows 为隐藏 STA PowerShell 中的 WPF `MediaPlayer`）播放，短期媒体 handle 只在 Provider→Playback 间传递，不进入 UI（见 [架构](../ARCHITECTURE.md)、[契约](../CORE_CONTRACT.md)）。网页端因此拿不到真实音频流或 FFT，也没有歌词数据流。细带使用**本地动画时钟**生成模拟律动，与玩偶动画"本地时钟而非 WPF 音频测量"的先例一致；界面和本报告都不把它描述为音频测量。

## 实现

- `src/ui/client/spectrum-bars.mjs`（纯逻辑）：种子化 PRNG（mulberry32，按曲目 `playInstanceId`／平台 ID 哈希，换曲换纹样）；低频基底高、高频基底低的分段基准与低频慢、高频碎的目标更新节奏；约 100 BPM 的固定律动脉冲只加强低频；按播放进度生成首尾稍低、中段更满的能量弧；快起（15/s）慢落（4.4/s）包络；峰值即时上升、保持 420 ms 后按重力下落；暂停时回落到缓慢"呼吸"基线。`renderSpectrumStrip` 把 64 个频段铺成每行两个字符：首字符按当前振幅映射到经典 ASCII 字符集（空格起、`$` 止的 72 级亮度梯度），次字符标出尚未回落的峰值，行序低频在底。
- `src/ui/client/spectrum-strip.mjs`（React 组件）：注册为 `shell.overlay` 的第二个条目（`id: fishfm.spectrum`，order 31）。宽 14px、纵向铺满对话区，默认距 overlay 左缘 348px（宿主未提供侧栏宽度 API，不猜宿主 DOM），可整体拖动或用方向键微调，位置写入本机偏好并在窗口缩窄时收回可见范围；`role="slider"` 暴露边界值。完整动态走 `requestAnimationFrame`，轻量与系统减少动态走 160ms 节拍，关闭时预积分出静态呼吸基线；行数按高度测量（8–64 行），行距随之伸展铺满整列。面板打开时不渲染。
- `src/ui/client/controller.mjs`：`fishfm.spectrum.visible.v1`（默认开启）与 `fishfm.spectrum.inset.v1` 两个本机偏好，不进入 Core、RPC 或模型事实。`panel.mjs` 界面选项增加"频谱细带"开关。
- 预览 harness 渲染全部 `shell.overlay` 条目，并加"播放/暂停演示"。

## 验证

2026-10-28，Windows 10.0.22631 / Node 24.22.1：

- 单元／客户端测试：`test/spectrum-bars.test.mjs` 11 项（确定性重放与换种子、边界、峰值不低于柱体、静默回落、峰值保持后下落、频段数钳制、细带行宽／字符集／低频在底／密度单调／峰值尾随、能量弧、哈希与 PRNG），`test/dsh-client.test.mjs` 新增 3 项（默认显示与面板隐藏、偏好读写与恢复、设置开关）。全量 `npm test` 594 项通过、0 失败、0 跳过。
- 模拟浏览器（`preview:ui` + 本机 Chrome）：细带位于 x=348、宽 14、高 935（铺满 overlay）；播放时 64 行、84 个可见字符、34 种不同字符；暂停后字符种类降到 5（呼吸基线）；拖动后 `fishfm.spectrum.inset.v1` 持久化为 468；设置开关关闭后首页不再渲染、重新开启后恢复；控制台无错误。深浅两套主题截图检查通过（截图仅存本机 `work/`，未入库）。
- 过程中修复的真实缺陷：overlay 框架为 `pointer-events:none` 导致拖动失效（组件补 `pointer-events:auto`）；首次挂载在面板内时不渲染，尺寸 effect 空依赖导致切回首页后不再测量（依赖改为面板与可见性）。

## 未验与边界

- 真实 DSH 宿主（0.2.1-rc.2）对同槽位第二个条目的渲染未在隔离 profile 实测；若宿主只渲染一个条目，细带会缺席而不影响播放。宿主侧栏宽度与默认 348px 的实际对齐同属未验，靠拖动兜底。
- 未在 macOS、真实音频、长时间连续运行与读屏软件下验证；CPU 占用只有本机观察（每帧写一个 14px 宽的 `<pre>` 文本），不作性能承诺。
- 细带是装饰性模拟，不反映真实声学能量，也不检测歌词或节拍；拖动只改变自身位置，不影响播放与推荐。
