# REV-02：退出与凭据清理结果

2026-10-13，修复 [issue #2](https://github.com/A7m0spHere/dsh-feiyuFM/issues/2)。

合成 `EACCES`、Keychain helper 失败与后端 `false` 返回均复现退出误报成功。DPAPI 删除不再吞掉权限或文件占用错误，仍尝试清理密文与元数据；仅不存在视为幂等成功。

Provider 先持久化 `revoked` 引用，再尝试删除；成功移除引用，失败保留用于重试。`finally` 清空内存 secret、cookie jar 与扫码会话。重建 Provider 后仍拒绝加载残留凭据，账号投影为 `login_required/cleanupPending`。Core 即使遇到清理失败也清空发现缓存，返回固定文案的 `credential_cleanup_failed`，不透传后端异常或 secret。

设置 RPC 保留 `cleanupPending/sessionDisabled`；界面显示账号已退出、清理失败，并提供“重试清理凭据”。仅删除完成后显示“本机凭据已删除”。

回归覆盖凭据后端、Provider、Core、认证设置 RPC 与生成客户端 bundle；使用合成凭据。Windows DPAPI 与 PowerShell 5.1 的真实密文写入、读取及删除回归通过。Keychain 故障使用 helper 替身，不代表 macOS 真机验收；日常账号和数据库未修改。
