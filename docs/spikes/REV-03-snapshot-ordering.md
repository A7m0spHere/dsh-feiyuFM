# REV-03：播放快照统一去旧

2026-10-13，修复 [issue #3](https://github.com/A7m0spHere/dsh-feiyuFM/issues/3)。

生成客户端 bundle 的可控 RPC Promise 复现：平台返回 revision=2 后，迟到 state 轮询将界面改回 revision=1；命令应答入口也未统一去旧。

客户端 `project()` 对轮询、命令与平台应答统一校验 revision，拒绝较低值；保留独立 playbackEpoch 对被本地播放控制取代的请求的保护。发现完成提示同样只使用被接收的快照。

故障注入还验证了现有协议的重启边界：真实 Core、文件 SQLite、fake playback 播放后关闭再重建，revision 保持原值，commandVersion 增加并恢复暂停。单靠 revision 无法区分同 revision 的重启前快照，因此相等时比较 commandVersion；无需新增 bootId。重连可接收重启后的暂停，旧进程平台响应不会撤销它。

Windows/Node 24.14.0：客户端、Core Host 与认证设置 RPC **70/70** 通过。覆盖平台新结果→旧轮询、跨窗口轮询新结果→旧平台响应、较旧命令应答、既有命令/轮询交错，以及文件数据库关闭重开。源客户端已同步生成 bundle。本轮未重载日常 Desktop；此记录不替代原生多窗口现场验收。
