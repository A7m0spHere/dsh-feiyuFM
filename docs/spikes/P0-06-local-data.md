# P0-06 本地数据部分验证

- 日期 / 环境：2026-09-27，Windows，本机 Node 24.14.0，`node:sqlite`。
- 状态：进行中。SQLite 迁移和重启恢复已验证；实际凭据后端、退出清理与脱敏日志尚未实验。
- 实验：`npm ci --ignore-scripts --no-audit --no-fund`、`npm test`。测试在临时目录创建 SQLite 文件，关闭并重开，检查当前曲目、暂停、凭据引用和历史统计。
- 观察：首版迁移可执行；重启后播放状态为暂停，之前报告的 3000 ms 进度保留但不会自动增加听歌次数；重复结束按 `playInstanceId` 去重。
- 证据：[测试代码](../../test/core.test.mjs)、[控制契约](../CORE_CONTRACT.md)。14 项离线测试通过。
- 未证明：凭据实际安全存储、账号退出清理、DSH 宿主异常恢复、长期运行与跨 Node 版本兼容。这里只保存 `credentialRef`，不保存 Cookie/Token。
