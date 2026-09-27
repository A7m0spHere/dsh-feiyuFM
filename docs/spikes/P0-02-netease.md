# P0-02 网易云接口：现在的把握程度与扫码运行手册

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0。
- 状态：**未与真实服务通信过**。本文记录我**知道什么、猜什么、以及扫码时要确认什么**，供 P3 使用。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) P0-02、P2、P3；验收关联 A01。

## 一个必须说清楚的限制

写这份文件时，**本环境的网络抓取被拦截**（`raw.githubusercontent.com`、`deepwiki.com` 均解析到非公网地址而拒绝），所以我**无法重新核对**社区资料，只能依据此前已知的社区通用做法。因此下面每一条都是**假设**，不是已验证事实。

我没有把任何一条假设写成"已经可用"。`NETEASE_ENDPOINT_PROVENANCE.confirmed` 是**空数组**，代码里有断言守着这一点。

## 当前假设（未确认）

| 角色 | 假设的形状 |
|---|---|
| `loginQr` | `POST /api/login/qr/key` → `data.unikey` |
| `qrImage` | `POST /api/login/qr/create?key=…&qrimg=true` → `data.qrimg`（base64 PNG，**由服务端生成**，所以本地不需要二维码编码器） |
| `loginPoll` | `POST /api/login/qr/check?key=…` → `code` 800/801/802/803，803 时带 `cookie` |
| `accountInfo` | `POST /api/nuser/account/get` → `profile.userId` |
| `recentTracks` | `POST /api/v1/play/record`（需要 `uid`，`type=1`） |
| `likedTracks` | `POST /api/song/like/get`（需要 `uid`） |
| `playlists` / `playlistTracks` | `POST /api/user/playlist`、`POST /api/v6/playlist/detail` |
| `search` | `POST /api/search/get/web`（`s`/`type`/`limit`/`offset`） |
| `resolve` | `POST /api/song/enhance/player/url`（`ids=[id]`、`br`） |

**中等把握**：二维码三件套（key/create/check）与 code 800/801/802/803 语义——这是社区客户端里最稳定的一组。
**低把握**：`recent`/`liked`/`playlists`/`search`/`resolve` 的参数名与是否需要 weapi 加密。部分接口在近年已收紧，**很可能需要 weapi（AES+RSA）加密**才能用；本项目**尚未实现 weapi**，这是扫码后最可能遇到的缺口。

## 扫码运行手册（用户操作）

```powershell
npm run login                      # 网易云扫码登录
npm run login -- --probe           # 登录后再探测账号接口，确认 profile
npm run login -- --dry-run         # 不落盘（凭据存内存），用于试探
npm run login -- --out <目录>       # 指定凭据与二维码目录
```

流程与产物：

1. 向平台要一个登录 key；
2. 请求服务端生成的二维码 PNG → 写到 `<目录>/login-netease.png` → **自动用默认看图器打开**，用手机 App 扫；
3. 每 3 秒轮询一次，直到 `authorized`（`scanned` 时会提示"请在手机上确认"）；
4. 会话经 **DPAPI CurrentUser 加密**落到 `<目录>/credentials/fishfm_netease.dpapi`；**SQLite 只留引用**，命令**从不打印会话内容**；
5. 输出只报告"存了多少密文字符"，不报告内容。

若二维码图片没拿到，会退化为打印登录 URL；若平台返回的形状与假设不符，命令会打印**响应的键名结构**（标量只报类型，避免泄漏 token），这正是修正 profile 所需的诊断。

## 已经离线验证的部分（这些是真的）

`test/login-flow.test.mjs` 用**本地 HTTP 服务器**模拟整个握手，10 项全过：

- 完整链路：要 key → 取二维码 → 801 等待 → 802 已扫 → 803 授权 → **会话进凭据存储** → 立刻可用（账号探测成功）；
- 二维码 data URL 正确写成 PNG（校验 PNG magic）；
- 二维码过期（800）如实报 `expired` 且不残留 pending 状态；
- 没有二维码图片时退化为 URL，**不影响登录本身**；
- 平台 500 / 404 分别映射为 `provider_failure`（可重试）/ `media_unavailable`，不会被吞掉；
- **DPAPI 在本机真实往返**：密文落盘 352 字符、明文不在文件中、解密与原文逐字节相等、删除后读回 null；
- 命令遇到未接入的平台（`--provider qq`）以独立退出码拒绝，不假装可用。

**这些证明的是本项目登录流程的逻辑正确**，不证明网易云的接口形状。

## 顺带修掉的真实环境问题

DPAPI 助手需要 **PowerShell 7**：Windows PowerShell 5.1 无法按程序集名加载 `System.Security.Cryptography.ProtectedData`，这是实际运行时撞到的失败（P0-06 的证据当时是用 `pwsh` 产生的）。现在助手会依次尝试 `pwsh` → `powershell.exe`，全部失败时给出**明确原因**而不是静默返回 null。

## 扫码后需要依次确认的事

1. `loginQr` 是否真的返回 `data.unikey`（若否，打印的形状就是答案）；
2. 二维码 PNG 是否可用（`data.qrimg`）；
3. `loginPoll` 的 code 语义与 803 是否带 `cookie`；
4. `accountInfo` 是否可用 —— 这决定能否拿到 `uid`，而**后续 recent/liked/playlists 全都需要 uid**；
5. search 与 resolve 是否可用；若返回空或 200 异常体，说明**需要 weapi 加密**，那是下一步的主要工作；
6. 只有以上都通了，A01 才可能从"未通过"变成通过。

## 仍未验证

- 以上全部端点形状；
- weapi 加密路径（**未实现**）；
- 会员/版权曲目的真实行为、播放 URL 的过期与重取；
- QQ 的端点（`--provider qq` 目前直接拒绝，因为连假设都还没有可靠的）。