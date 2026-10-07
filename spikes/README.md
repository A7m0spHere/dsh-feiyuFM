# 早期可执行探针

这里保留 P0 阶段用于核实 DSH、WPF、命名管道、窗口和 DPAPI 的源码。它们不是生产插件、当前测试入口或完整安装要求；原路径保留，便于阅读历史报告中的命令。

| 文件 / 目录 | 历史用途与证据 |
|---|---|
| `P0-01-lifecycle.mjs`、`P0-06-dpapi.ps1` | DSH 事件/工具、子进程与合成凭据往返；[P0-01](../docs/spikes/P0-01-dsh.md)、[P0-06](../docs/spikes/P0-06-local-data.md) |
| `P0-01-desktop-probe/`、`P0-01-desktop-pipe-client.mjs` | 隔离 desktop bundle 与单次管道往返；同 P0-01 报告 |
| `P0-04-wpf-playback.ps1`、`P0-04-pipe-host.ps1`、`P0-04-pipe-client.mjs` | 早期真实 WPF/管道实验；[P0-04](../docs/spikes/P0-04-playback.md) |
| `P0-05-window-probe.ps1` | 曾比较原生窗口方案；[P0-05](../docs/spikes/P0-05-desktop.md)，当前 UI 使用 DSH 页面席位 |

不要将探针目录安装为 FishFM，或因文件仍在这里就重复操作真实 profile/账号/音频。当前安装见 [DELIVERY](../docs/DELIVERY.md)，维护与隔离验证见 [scripts](../scripts/README.md)。

实现报告和截图位于 [docs/spikes/](../docs/spikes/README.md)，与本目录的可执行脚本分开维护。
