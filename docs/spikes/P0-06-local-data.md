# P0-06 本地数据部分验证

- 日期 / 环境：2026-09-27，Windows，本机 Node 24.14.0，`node:sqlite`。
- 状态：进行中。SQLite 迁移/重启、隔离 DSH 凭据服务的合成授权记录与删除、Windows 用户级 DPAPI 加解密已验证；真实账号退出、desktop profile 和完整脱敏日志尚未实验。
- 实验：`npm ci --ignore-scripts --no-audit --no-fund`、`npm test`。测试在临时目录创建 SQLite 文件，关闭并重开，检查当前曲目、暂停、凭据引用和历史统计。
- 观察：首版迁移可执行；重启后播放状态为暂停，之前报告的 3000 ms 进度保留但不会自动增加听歌次数；重复结束按 `playInstanceId` 去重。
- 证据：[测试代码](../../test/core.test.mjs)、[控制契约](../CORE_CONTRACT.md)。14 项离线测试通过。
- 凭据实验：本机 DSH `0.1.7-rc.2` 的 `ctx.credentials` 提供 `modifyRecord`、`readRecord`、`deleteRecord`。在隔离 Web profile 中，用 [DPAPI helper](../../spikes/P0-06-dpapi.ps1) 通过 stdin 接收合成文本，以 `CurrentUser` 加密后写入 `grant` 记录；读出解密成功，记录只含密文，删除后再读为空。`spikes/P0-01-lifecycle.mjs` 的运行标记为 `CREDENTIAL_READ:true`、`CREDENTIAL_CIPHER_ONLY:true`、`CREDENTIAL_REMOVED:true`，没有打印原值。SQLite 只存 `credentialRef`。
- 存储位置与边界：本机 `dsh-credentials-local` 把记录写到 `$DSH_HOME/.credentials.yaml`。隔离 profile 位于项目临时目录，其文件继承了 `BUILTIN\Users` 可访问的 ACL；该版本的 provider 在 Windows 跳过 POSIX 权限检查。实际用户的 `.dsh` 文件 ACL 不同，但实现不能依赖所有安装位置均为私有。Windows 首轮方案应存 **DPAPI CurrentUser 密文 grant**，数据库只留记录键；跨设备同步源码时不能同步该密文作为可用登录态。[Microsoft DPAPI 文档](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=netframework-4.8)说明这是 Windows 用户级保护。
- 未证明：真实网易云/QQ 授权材料的序列化、刷新与退出删除，desktop profile 的凭据服务、DSH 宿主异常恢复、长期运行与跨 Node 版本兼容。合成测试不能替代实际账号实验；Cookie/Token 仍不入库。
