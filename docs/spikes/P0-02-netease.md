# P0-02 网易云接口：实测结果与扫码运行手册

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0。**无账号**下的探测；网络经代理（`music.163.com` 解析到 198.18.0.52）。
- 状态：**登录握手的关键环节已实测确认**（下面标 CONFIRMED 的都是真实响应）；需要账号的接口仍未验证。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) P0-02、P2、P3；验收关联 A01。

## 方法

探测**不需要账号**：路径或参数不对时，服务会明确回答 `接口未找到！` 或 `参数错误`。因此可以靠"改对参数直到服务接受"来确认形状，而正确时服务会直接返回真实数据（`unikey`、等待扫码状态、搜索结果）。

## 已确认（真实响应，2026-09-27）

| 角色 | 结论 | 实测响应 |
|---|---|---|
| `loginQr` | ✅ `POST /api/login/qrcode/unikey`，**必须带 `type=1`** | `{"code":200,"unikey":"454fd6d9-2c2b-482b-b2ea-eb49dd1a464d"}` |
| `loginPoll` | ✅ `POST /api/login/qrcode/client/login`，带 `key` + `type=1` | 新 key 立即轮询 → `{"code":801,"message":"等待扫码"}` |
| 轮询状态码 | ✅ **801 = 等待扫码**（实测）；800 = 二维码不存在或已过期（实测，见下） | `{"code":800,"message":"二维码不存在或已过期"}` |
| `accountInfo` | ✅ `POST /api/nuser/account/get`；未登录时如实返回空 | `{"code":200,"account":null,"profile":null}` |
| `search` | ✅ **GET** `/api/search/get/web?s=…&type=1&limit=…` → 真实歌曲列表 | 返回 `result.songs[]`（含专辑、歌手、时长字段） |
| `resolve` | ✅ `POST /api/song/enhance/player/url`，带 `ids=[id]` + `br` | `data[0]` 含 `url`/`expi:1200`/`code`；**未登录时 `url` 为 null** |

参数错误的证据（说明这些路径**存在**，只是参数不对）：

- `POST /api/login/qrcode/unikey`（无 `type`）→ `{"msg":"参数错误","code":400}`
- `POST /api/song/enhance/player/url` 带 `ids`+`br` 才被接受

**我原先的假设是错的**：`POST /api/login/qr/key` 返回 `{"code":404,"message":"接口未找到！"}`。真实路径是 `/api/login/qrcode/unikey`。这条更正来自实测，不是文档推断。

## 一个仍未解决的缺口：二维码图片需要本地生成

实测候选路径全部 `接口未找到`：

- `POST /api/login/qrcode/create`、`GET /api/login/qrcode/create?key=…&qrimg=true` → `接口未找到`

也就是说**服务端不提供二维码图片**，必须由客户端把 `https://music.163.com/login?codekey=<unikey>` 渲染成二维码。而本机**没有任何二维码库**（无 npm 依赖、无 `qrencode`、Python 无 `qrcode`/`segno`；仅有 PIL，但 PIL 不含二维码编码器）。

**已解决**：用户批准引入二维码库后，登录命令改为**本地渲染**（`qrcode@1.5.4`，MIT；来源与许可记录在 [DECISIONS 第 0 节](../DECISIONS.md)）。后续 DSH 面板登录也复用同一依赖，在 Core 服务端生成 PNG Data URL。二维码内容为 `https://music.163.com/login?codekey=<unikey>`，没有把登录 key 作为独立字段发给页面。

**已用真实服务验证**：`node scripts/login.mjs --dry-run --timeout 12` 拿到真实 key（`f3b9a6d7…`）、成功渲染二维码并打开、随后按 3 秒间隔轮询直到超时。也就是说**扫码之前的每一步都在真实服务上跑通了**，只差用户扫码。

## 顺带确认的 800 语义

第一次探测时，我用一个**先前已探测过、已过期**的 key 轮询得到 `800 二维码不存在或已过期`。用新 key 立即轮询得到 `801 等待扫码`。所以：

- 800 与 801 的区别是**真实存在**的，且新 key 的初始状态是 801；
- 登录命令必须在拿到 key 后**尽快**开始轮询，否则会看到 800（这也解释了为什么"过期"提示是正常的失败路径而不是 bug）。

## 扫码运行手册

```powershell
npm run login                      # 网易云扫码登录
npm run login -- --probe           # 登录后再探测账号接口
npm run login -- --dry-run         # 凭据只存内存，不落盘
```

流程：要 key → 展示二维码（做法待定）→ 每 3 秒轮询 → `scanned` 提示手机确认 → `authorized` → 会话经 **DPAPI CurrentUser** 加密落盘（`<目录>/credentials/fishfm_netease.dpapi`），**SQLite 只留引用，命令从不打印会话内容**。

## 已经离线验证的部分

`test/login-flow.test.mjs`（10 项）用本地 HTTP 服务器模拟整个握手：完整链路（801→802→803→会话存储→立即可用）、过期路径、无图片时的退化、500/404 错误映射、**DPAPI 在本机真实往返**（密文 352 字符、明文不在文件中、逐字节相等、删除后读回 null）。

这些证明**本项目登录流程逻辑正确**，配合本轮实测，握手形状也已被真实服务确认；仍未验证的是**授权码之后**的部分。

## 仍未验证

- 802/803 的真实语义（801 与 800 已确认；803 是否带 `cookie`、字段名是什么，需要真正扫一次）；
- 需要账号的 `recent`/`liked`/`playlists`/`playlistTracks`（无 uid 无法测；`/api/v1/play/record` 探测时返回 HTTP 400，形状可疑）；
- weapi 加密路径（**未实现**）；
- 会员/版权曲目的真实行为（已确认未登录时 `url` 为 null，需登录后复测）。
