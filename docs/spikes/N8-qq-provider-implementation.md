# N8 QQ Provider 与双平台来源实施记录

2026-11-17，Windows，开发分支 `feat/qq-provider-source`，基于 `9b5908a`。本记录保存本轮证据快照，持续状态仍在开发状态维护。本记录接续 [接入方案](../design/FEAT_QQ_PROVIDER.md) 与 [初次调研](N8-qq-integration-options.md)，运行和验收状态统一见 [开发状态](../PROJECT_PLAN.md)。

本页的双账号探针命令对应提交 `5224de0`。单账号修订与当前验证命令见 [控制契约](../CORE_CONTRACT.md) 和 [脚本说明](../../scripts/README.md)。

## 实施选择

当前采用固定 `@yakult-green-tea/qq-music-api@3.3.7` 的公开 `/serverless` 入口，在延迟启动的 Node Worker 内执行。Core 与 Worker 经消息通信，Worker 自身的 fetch 使用请求级代理配置与取消信号。运行时密钥与 sealed token 进入既有 DPAPI／Keychain，SQLite 保存引用。

首版支持双账号独立操作、一个自动来源与一条播放队列。默认网易云，切源只改变后续选曲，曲目本身的平台决定取链来源。QQ 规范 MID、艺人、时长、喜欢／歌单分页、歌词和推荐来源，明确拒绝试听链接。账号上下文与来源 revision 共同防止迟到结果进入新账号或新池。

QQ 根入口作为备选保留在设计比较中。当前入口已经取得真实二维码，完整账号能力仍待用户授权后的测试。用户于本轮明确选择稍后进行真实 QQ 账号验证。

## 验证范围

- 离线回归覆盖双账号二维码／忙碌状态、同 ID 跨平台取链、单平台候选与 next 回退、切源保留当前实例与暂停、账号资源失效、试听拦截、歌词 MID、分页和 token 旋转。
- 共享刷新拥有独立取消控制，取消播放等待者后导入仍可继续。切源期间尚在模型预留阶段的旧筛选能够取消并以零实际调用终结账本，实际已发生 usage 仍按现有逻辑记录。
- 真实 React 与生产 bundle 在 ego-browser 中完成来源保存、双平台并发申请、逆序响应、只取消网易云而保留 QQ 和键盘焦点检查。窄容器实测宽度 440px，面板 clientWidth 与 scrollWidth 同为 423px，浅色／深色均核对。RPC 使用模拟数据，实际账号验证另列。
- 隔离官方 DSH profile 安装自带依赖的 tgz，通过实际认证 RPC 检查双适配器、默认来源、切源、过期写冲突、QQ 二维码、取消、插件重启保存来源与恢复暂停。账号授权及真实歌曲播放仍待后续验证。

最终检查数量、候选包摘要与隔离结果见 [脱敏结果](assets/N8-qq-provider-implementation.json)。单元、浏览器模拟、隔离宿主与真实平台证据按各自范围记录。

## 资源与包体积

固定包自身 620 文件、1,979,731 字节。锁定运行依赖从 288 项增加到 363 项，净增 75 项。已为上游缺少随包许可原文的依赖补充声明，并从 `only@0.0.2` 随包 README 识别其 MIT 许可原文。

一次独立 Node 24.22.1 探针调用空会话 `/login/status`，Worker 启动到响应为 719ms，整体进程 RSS 从 45,805,568 增加到 82,190,336 字节。资源列表没有 TCPServerWrap，关闭后剩余 MessagePort 为 0。此样本只测量入口加载与空会话，真实账号后台连接、取链延迟和长期内存仍待测量。

## 复现入口

```powershell
npm run build
$env:FISHFM_TEST_REAL_AUDIO='0'
node --test --test-concurrency=1 --test-timeout=30000 test/*.test.mjs
npm run verify:package
node scripts/probes/initial-state-install.mjs --package <最终候选tgz> --out <新隔离目录> --qq-source
```

真实账号后续通过 `node scripts/probes/qq-provider-live.mjs --out <新目录>` 发起。手机 QQ 确认后依次检查导入、搜索、完整取链、静音播放、歌词、推荐及重建恢复，结束清理临时凭据。业务空结果、会员／地区限制和仅试听分别记实际结果。

## 剩余边界

真实账号导入、完整播放比例、听音、推荐结果及会话恢复待验。macOS Keychain／真实媒体与两平台连续使用待对应环境验证。混合自动推荐与跨平台同一录音匹配仍按后续设计处理，当前切回来源需重新补池。

本分支为未发布源码交付，发行版能力继续按其 release 记录读取。A01 双平台完整验收仍需上述真实账号证据。

本轮预览服务和隔离宿主已退出。自动审批拒绝删除 `.tmp/qq-*` 下的验证目录、浏览器脚本和日志，只返回 `blocked by policy`。这些本机临时材料保留，最终候选包单独保留在 `.tmp/qq-release-final/`，脱敏结果已纳入本记录。
