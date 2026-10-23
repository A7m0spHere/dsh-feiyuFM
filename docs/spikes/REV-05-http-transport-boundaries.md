# REV-05：HTTP 凭据、重定向与响应大小边界

日期：2026-10-23。对应 [Issue #12](https://github.com/A7m0spHere/dsh-feiyuFM/issues/12)。本轮修复项目 HTTP transport 的可验证边界，不将风险假设记为已发生的凭据泄露。实时基线和未验项只在 [PROJECT_PLAN](../PROJECT_PLAN.md) 维护。

## 实际调用与信任来源

| 路径 | 请求与凭据规则 |
|---|---|
| `bin/fishfm-core.mjs` → `buildProviderRegistry` → 项目 HTTP transport | 生产网易云端点固定为 `https://music.163.com`，可信 origin 独立于端点描述符。`search` 为 `/api/search/get/web`；`resolve` 为 `/api/song/enhance/player/url`。只在该 origin 使用内存恢复的网易云 Cookie |
| `neteaseEndpoints` 的 `loginQr/loginPoll` | 保留旧 type=1 描述符供本地诊断；即使 jar 有旧账户，每次 QR 请求都从空 jar 开始，不发送旧 Cookie，只返回本次响应 Cookie |
| `createCommunityTransport` | 生产 type=3 QR、账号、近期记录、喜欢、歌单、详情、每日推荐、私人 FM 和相似歌曲复用固定依赖 `@neteasecloudmusicapienhanced/api@4.40.1`。QR 始终传 `cookie: {}`；确认的新会话经 `login_status` 验证后才保存；普通调用使用网易云会话与现有刷新／DPAPI 路径 |
| 接口包内部 HTTP | 本地核对 `util/config.json` 的 API 域名为 HTTPS 的 `interface.music.163.com`、`interfacepc.music.163.com`、`interface3.music.163.com`；各模块经 `util/request.js` 的 Axios 请求。包内部的设备／校验等额外域名仍由该固定依赖维护。本轮不修改依赖源码，不声称内部 Axios 已应用项目 transport 的跳转和流式限额 |
| QQ | 保留 Provider 与合成合同测试，无生产端点、默认 origin 或真实登录。本轮未恢复 QQ 接入 |
| CLI 与生命周期脚本 | 显式配置 IP 回环模拟 origin；CLI 的 `FISHFM_NETEASE_BASE` 还必须使用 `--dry-run`，先校验再创建凭据库，不能将已有账号转发到测试端点 |
| 音频 | 解析后交 Playback；此 API jar 不跟随媒体 CDN URL，不改变 IPC Token、凭据库、日志脱敏或模型预算 |

## 修改与取舍

- 每个 HTTP transport 只接受一个 `trustedOrigin`，不再从端点表推导信任、不接受共享 jar。默认 HTTPS；`allowInsecureLoopback` 只接受显式 `127.0.0.1/[::1]` fixture。Core 的网易云 origin 不可通过 endpoint 或 adapter 的 `trustedOrigin` 覆盖。
- 使用 `redirect: manual`，最多 5 次同源跳转；先核对 Location，再吸收跳转响应 Cookie、取消正文并发下一次请求。跨源、端口变化、子域和 HTTPS→HTTP 均拒绝；注入的 fetch 若自动跟随也拒绝响应。301/302 POST 和 303 遵循方法切换，307/308 保留表单。
- origin-bound Cookie jar 校验 Domain，按 Path 边界、Secure 和到期发送；Max-Age/Expires 可删除旧项。父域不会扩大唯一可信 origin。已存凭据仍是原始 Cookie 字符串，恢复时绑定本 origin 的 `/`，不迁移凭据格式。原始字符串工具仍用于接口包会话合并，但不充当跨站浏览器 jar。
- `includeCookies: false` 不发送、吸收或导出本地 Cookie；描述符不得注入 Cookie/Authorization/Host。新 QR 不借用 key 响应或旧账号 jar，共用登录状态机无新凭据时拒绝授权。
- 默认正文 4 MiB、Cookie 16 KiB，均可通过内部选项调整。正文预检 Content-Length 并累计解压后流字节，超限取消；单次 Cookie 输入与全 jar（含路径）受限，失败保持原 jar。JSON 内的 cookie 也受限。正常超时覆盖跳转和正文，取消后移除监听器。
- HTTP 底层错误只保留固定文本和网络错误码，不把 raw URL/query/Cookie/cause 交给上层。日志只记 role、provider 和 Cookie 数量。

路径与 Cookie 属性规则参考 [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265)；重定向方法规则参考 [Fetch HTTP-redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch)。本实现采用更严格的精确 origin，不是完整浏览器 Cookie 实现。

## 可复现验证

环境：Windows，Node 24.22.1。所有账号、Cookie、搜索／解析数据均为合成；HTTP 使用本地随机端口，HTTPS 降级用可注入 fetch，不访问真实账号或平台，不新增模型请求。

```powershell
node --test --test-timeout=30000 test/transport-security.test.mjs
node --test --test-timeout=30000 test/transport.test.mjs test/login-flow.test.mjs test/netease-qr.test.mjs test/netease-community.test.mjs test/providers.test.mjs test/providers-qq.test.mjs test/discovery-provider.test.mjs
$env:FISHFM_TEST_REAL_AUDIO='0'
npm test
npm run build
npm run audit:acceptance
npm run verify:package
```

| 项目 | 结果与证据 |
|---|---|
| 新增安全回归 | **通过，19/19**；`test/transport-security.test.mjs` 覆盖非白名单／平台混用、重新校验、同源 302/307、循环上限、跨源零后续请求、降级／子域／端口、自动跟随注入、Domain/Path/Secure/到期、双平台 jar、无 Cookie role、伪装请求头、QR 新旧隔离、旧 jar 授权回退、流式／声明／gzip 超限、Cookie 累积超限、错误脱敏与 CLI 门禁 |
| 现有平台与登录回归 | **通过，72/72**；本地搜索／解析、完整扫码流程、新账号验证与旧账号隔离、接口包 Cookie 刷新、凭据清理、Provider 退化及固定依赖静默输出。证明模拟接口兼容，不代表真实平台重新验收 |
| 全量离线套件、构建、引用及包检查 | **通过**；全量零失败，模块检查、构建/debug smoke、文档引用及包白名单通过。具体版本基线见 [PROJECT_PLAN](../PROJECT_PLAN.md) |
| 真实网易云登录／搜索／音频、原生 Desktop、macOS | **未执行**；未读取日常凭据、未重载日常插件，不以本地安全回归补记现场通过 |
| QQ 真实端点／登录 | **未执行，继续暂缓** |
| 数据／凭据格式迁移 | **不适用**；SQLite、DPAPI/Keychain 格式未改变 |

## 未证实的风险与剩余边界

本地两个不同端口服务器直接对照 Node 原生 `fetch(..., {redirect: 'follow'})`：目标端确实收到跳转请求，但未收到合成 Cookie。**该环境下“原生跨源跳转直接转发 Cookie”的假设不成立**；不能据原代码或本次测试断言历史发生过泄露，也不能外推到任意 fetch 实现。修复后项目 transport 直接阻止第二次跨源请求。

确认并修复的是端点信任未独立声明、jar 不区分路径、正文无上限，以及共用新登录可能回退旧 jar 的边界。固定依赖内部 Axios 未重写；真实账号和第三方线上行为未执行。本轮不扩展为整个依赖树的安全审计，不改变推荐行为或提高费用预算。
