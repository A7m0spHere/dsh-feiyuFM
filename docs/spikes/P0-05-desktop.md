# P0-05 桌面工具链与窗口行为：实测记录

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0。
- 状态：**工具链存在性已实测**；**窗口行为（透明、置顶、点击穿透、位置恢复、DPI）用本机 WPF 实测**；**Tauri 本身的构建未完成**（原因见下）。透明窗/托盘等 UI 验收**不能**据此勾选完成。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) P0-05；验收关联 A07。

## 1. 工具链（实测，未安装任何东西）

| 组件 | 结果 |
|---|---|
| `rustc` | **1.95.0 (59807616e 2026-04-14)** — `C:\Users\86137\.cargo\bin\rustc.exe` |
| `cargo` | **1.95.0 (f2d3ce0bd 2026-03-21)** |
| `rustup` | 存在 |
| WebView2 运行时 | **154.0.4258.37**（Tauri 在 Windows 上的前置依赖） |
| `node-gyp` / MSVC `cl` | 不存在（Node 原生模块编译用不到；Tauri 用 cargo 而非 node-gyp） |

也就是说：**Tauri 的两大前置（Rust 工具链 + WebView2）在本机都满足**。

## 2. 窗口行为：本机能不能做到？（用 WPF 实测）

P0-05 的问题是"透明、置顶、拖动、歌曲文本、控制、托盘恢复、位置保存；检查 DPI/屏幕变化与透明区域点击"。

要区分两件事：
- **操作系统/桌面合成层是否支持这些行为**——这决定方案是否可行；
- **Tauri 是否提供对应的 API**——这决定用哪个框架。

我用本机 WPF（已在 P1 用于音频宿主）验证第一件事，因为它是零依赖的。探针脚本：[spikes/P0-05-window-probe.ps1](../../spikes/P0-05-window-probe.ps1)。

**实测输出（2026-09-27，本机）**：

```
allows transparent window          PASS  WPF accepted AllowsTransparency=True
background is transparent          PASS  Background=#00FFFFFF
topmost accepted                   PASS  Topmost=True
borderless                         PASS  WindowStyle=None
click-through applied              PASS  exStyle 0x80108 -> 0x80128
position applied                   PASS  OS rect=(150,175) asked=(120,140) at scale 1.25x1.25 -> expected=(150,175)
scale factor readable              PASS  device scale=1.25x1.25
virtual screen readable            PASS  virtual=-1536,0 3072x864
dpi/scale readable                 PASS  primary width=1536 (WPF units)
tray icon show/hide                PASS  NotifyIcon shown then removed

PROBE_RESULT: 10/10 window behaviours supported on this machine
```

### 探针暴露的两个真实点

1. **本机是 125% 缩放**，而 **WPF 的窗口坐标是设备无关单位、`GetWindowRect` 返回物理像素**：请求 `(120,140)` 时 OS 报 `(150,175)`，比值正好 1.25。这不是探针的假失败——**它正是"位置记忆"会踩的坑**：在一个缩放下存的位置，换到另一个缩放就会偏移。
   → 因此 [窗口位置逻辑](../../src/ui/window-state.mjs) 现在会**按缩放比换算**位置（源为 `rescaled`），并记录新缩放；只有换算后仍不可见时才回退。测试用 400→500 的换算断言了这一点。
2. **探针自己的输出曾全部丢失**：`$results['x'] = Report ...` 会把函数里的 `Write-Output` 一并捕获成"返回值"，于是只剩汇总行。改成 `Write-Host` 后逐项可见。记下来是因为"探针看起来通过了但什么都没打印"很危险。

## 3. Tauri 构建：为什么没有完成

`cargo` 需要访问 crates.io 才能拉取 Tauri 与数百个依赖。本环境的网络此前已多次表现为**受限**（网页抓取被解析到非公网地址、`github.com:443` 连接被重置），本次对 crates.io 的探测同样超时。因此：

- **没有**在本机完成一次 Tauri 构建；
- **不能**声称 Tauri 的透明窗/托盘/多屏 API 已验证；
- 也没有"生成一个空 Tauri 工程"来充数——按项目规则，不提前生成空代码包。

要完成 P0-05 的 Tauri 部分，需要**一次可访问 crates.io 的构建**（约需下载并编译数百个 crate）。在那之前，U1/U2 的窗口壳保持未验证，UI 验收不勾选。

## 4. 这对实现顺序的影响

ARCHITECTURE 的硬约束是"可见窗口及桌面 UI 进程退出，不应停止 Core 或 Playback"，而这条**已经**由进程边界满足：Core 与 Playback 由插件拥有并在独立进程中运行（P1/I1 已验证），窗口只是消费者。

因此窗口壳的缺失**不阻塞** Core/播放/人格的推进，也不阻塞 U1 的桥接与位置逻辑（已离线完成）；它阻塞的是 **A07** 与 U2 的"可见窗口"部分。

## 5. 仍未验证

- **Tauri 构建与 Tauri 的窗口 API**（透明、置顶、点击穿透、托盘、多屏/DPI 事件）；
- 真实 Windows 的 `WM_DISPLAYCHANGE` / 缩放变更事件路径（U1 的位置恢复是纯几何验证）；
- 托盘图标与"隐藏/显示"在真实 shell 下的行为；
- 本机 WPF 探针证明的是**操作系统支持**，不等于所选框架一定暴露该能力。