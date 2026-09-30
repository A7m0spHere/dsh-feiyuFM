# U6 扫码授权失败：社区方案与真实验证

更新：2026-10-01。状态：用户再次扫码后，同一二维码重试已真实完成授权；DPAPI 含 `MUSIC_U`，`login_status` 返回账号 ID。尚未导入或播放歌曲。

## 社区调研与取舍

| 来源 | 可采用的事实 | 本次处理 |
|---|---|---|
| [主线扫码模块](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/module/login_qr_check.js)、[文档](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/public/docs/home.md) | 当前 key/check 均用 type 3；800/801/802/803 分别为过期/等待/已扫描/已授权；803 后使用返回 Cookie 检查账号 | 使用已固定的 `@neteasecloudmusicapienhanced/api@4.40.1`，不升级依赖；生产扫码改用社区模块，匿名 cookie 上下文独立于旧账号 |
| [无浏览器 Cookie 示例](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/public/qrlogin-nocookie.html) | 等待响应也有 Cookie；成功状态必须按 code 判断；明确把新 Cookie 传给登录状态接口 | 仅 803 且有非空 `MUSIC_U` 才校验；取得账号 ID 后再写 DPAPI 和 SQLite 引用 |
| [网页登录修复 PR #201](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/pull/201)、[YesPlayMusic 网页登录 PR](https://github.com/qier222/YesPlayMusic/pull/2474/files) | 引入网页登录、浏览器上下文和额外验证等替代路径；前者仍未合并 | 本次不引入浏览器模拟或宿主改造，先实测现有 PC 流程 |
| [旧项目 Issue #1748](https://github.com/Binaryify/NeteaseCloudMusicApi/issues/1748) | 有扫码确认后 502 和响应头过大的报告 | 作为排查线索；本机这次成功响应头为 5728 字节，没有证据证明属于该问题，不改 HTTP 头上限 |

第三方源码未复制。只调用已安装包的 `module/login_qr_key.js`、`module/login_qr_check.js` 和 `util/request.js`，范围与 MIT 许可见 [声明](../../THIRD_PARTY_NOTICES.md)。网络错误兼容层由 FishFM 实现。

## 实际问题

1. 旧解析器把未知状态但带 Cookie 的响应也当作授权成功。原桌面 DPAPI 只有 `NMTID`，没有 `MUSIC_U`；真实账号检查为游客态。不能由此推断用户账号曾有效后过期。
2. 旧扫码走 type 1 直连，账号/导入走社区包，缺少一致的授权流程。生产 key/check 现已统一使用固定社区包的 type 3。
3. 包内 `login_qr_check.js` 的 catch 引用了 try 块中的 `result`；请求拒绝时会覆盖原错误。兼容层保留请求原始拒绝，错误响应只输出白名单的阶段与状态码，已用真实模块的失败分支验证。
4. 用户第一次确认后的检测为临时 502，原来的提示丢失错误码。直接诊断保留了 502；使用同一二维码再次检测，真实返回授权成功，随后账号校验成功。没有要求用户重扫该二维码，也没有伪造成功。

## 修复行为与证据

- 800 才表示二维码过期；801/802 保持等待；未知代码或没有 `MUSIC_U` 的 803 明确失败，不借用旧 Cookie jar。
- 新 Cookie 先在内存校验账号 ID，成功后才保存。失败不覆盖旧凭据；已确认的候选可重试账号校验，不再请求新的 QR 授权结果。
- 检测 502/5xx 时最多重试一次，间隔 750ms，仍用相同 key；每次 QR 请求上限 10s，账号请求 15s，宿主轮询等待上限 40s。无无限重试，不增加模型请求。
- 面板区分扫码检测错误、登录校验错误、已存会话失效与二维码过期，并提供重试检测/校验入口。
- 慢请求期间退出登录或开始新登录，旧结果不得写回凭据。
- 本机实际成功后，只读检查：7 个 Cookie 名称中包含 `MUSIC_U`，无 `MUSIC_A`；账号状态 authorized，账号 ID 存在。Cookie 值未打印，也未写入仓库。

测试覆盖游客响应误判、凭据缺失、原始错误保留、502 同 key 重试、先校验再提交、失败保留旧凭据、退出竞争和 UI 提示。固定等待 600ms 的旧启动测试改为等待实际失败通知，避免并行时误报。整套并行测试在 Electron 上曾发生子进程超时，限制测试并发后通过；不将超时结果记为通过。

最终检查：桌面 Electron-as-node 的 `--test --test-concurrency=2 --test-timeout=30000` 为 **240/240**；构建检查 **69 模块**并通过调试冒烟；证据审计 10/10、0 失效链接。另起只读进程再次请求 `login_status`，返回 authorized 和账号 ID。

部署：DSH 有正在运行的对话与后台任务，没有强制退出宿主。用户已停用/启用音乐插件，核对 Core pid 从 `51528` 变为 `18864`、宿主 `67624` 保持；授权复核仍通过。客户端可热加载。宿主设置 RPC 的 40s 等待上限在下次正常重启 DSH 后生效。首次 502 的更底层原因未证实；同 key 重试成功不能反推一定是网络或响应头问题。

有效账号扫码已验证；平台曲目导入、搜索、平台音频与两小时运行仍未完成。临时 QR、诊断脚本和 key 文件在本轮结束时清理；账号凭据只留在 DSH_HOME 下的 DPAPI 存储。
