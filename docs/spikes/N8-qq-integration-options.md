# N8：QQ 音乐接入方案调研（未实现）

- 日期 / 环境：2026-11-17，Windows 11，Node 24.22.1，本机网络。
- 范围：**只做外部调研与源码比对**。未安装任何新依赖、未调用真实 QQ 账号、未改产品代码、未跑全量回归。
- 关联：[P4-P5 平台适配](P4-P5-platforms.md)、[PROJECT_PLAN](../PROJECT_PLAN.md) 接续顺序第 4 项、[MVP](../MVP.md) A01。
- 状态：方案已比较，**未实现、未联调**。下文「已核实」只指本次能直接读到或测到的内容，其余一律标未验。

## 2026-11-17 后续核对与修订

本报告保留初次调研时的判断。后续对固定 npm 发布包 `3.3.7` 的只读核对发现，下文的凭据形态、运行时选择和改动范围需要修订。当前规划统一见 [双平台接入提案](../design/FEAT_QQ_PROVIDER.md)。

- Node 登录返回 `qqmusic_session` token，重启恢复还需要对应的 stored 会话。现有加密存储应适配公开 `configureAuthSessionRepository`，单独保存 token 不足以恢复。
- 根入口没有把 `HOST` 传入监听器，设置该环境变量无法限定回环地址。同包公开 `/serverless` 的 `handleRequest` 也可作为本地无监听入口验证。`3.3.7` 无 MQTT 中继时手机 QQ 可使用 ptlogin HTTP 通道。
- 默认推荐、批准池、认证 RPC 与共享歌词 ID 校验包含网易云假设，完整接入需要同步调整。双登录后的自动来源、切换时机和账号失效范围已纳入提案。
- npm 的 620 文件、1,979,731 字节对应包自身解包数据，7 项为该包的直接依赖。完整传递依赖、安装体积与运行资源另行测量。
- 裸调搜索的一次失败只说明该次请求缺少可用上下文。自建端点的维护成本判断仍需结合签名、登录与长期上游变化。

## 结论

1. **走社区接口包，不走官方开放平台。** 腾讯音乐开发者平台面向合作方提供 API/SDK，接入材料是 `APP_ID`／`APP_KEY`／私钥、设备注册与 OpenID 登录，属于商务合作通道，不适合个人开源插件自行申请。
2. **首选 `@yakult-green-tea/qq-music-api`（MIT，Node ≥20），固定精确版本。** 它是 Rain120 原项目的活跃分支：路由覆盖登录、搜索、播放、歌词、个人曲库、推荐与相似歌曲；有 CI、错误对照表、相容与版本政策；近 30 天下载量 25,500，与现有网易云包（32,066）同一量级；同宿主生态里的 `dsh-music-panel` 已固定使用 `3.3.6`。
3. **备选 `@sansenjian/qq-music-api` 的 `/sdk` 函数式入口**（MIT，无监听端口），架构上更贴合本仓库，但 SDK 未覆盖个人曲库，需要下探 `/services` 内部入口，生态验证也少一个量级。
4. **不推荐自建端点。** 本次实测裸调 `musicu.fcg` 搜索模块返回 `req_0.code = 2001` 且结果全空，说明手写请求还缺 `comm`／签名等上下文；这正是「成熟包替我们承担上游漂移」的理由。
5. **接入前必须先解决三处架构冲突**：单 origin 传输白名单、根模块 require 即监听、包体积与许可清单。三者都有可行解，但都不是零成本。

## 1. 仓库现状

| 已有 | 位置 | 状态 |
|---|---|---|
| QQ 适配器 | [`src/providers/qq.mjs`](../../src/providers/qq.mjs) | 复用共享状态机，只写了 `parse` 与种子来源；`unverifiedEndpoints()` 返回全部角色 |
| 共享契约与状态机 | [`src/providers/platform.mjs`](../../src/providers/platform.mjs)、[`contract.mjs`](../../src/providers/contract.mjs) | 账号生命周期、能力诚实性、来源降级、错误映射都已就绪，可直接复用 |
| 注册与协调 | [`src/core-host.mjs`](../../src/core-host.mjs) 第 193–226 行、[`src/providers/coordinator.mjs`](../../src/providers/coordinator.mjs) | 有 `endpoints` 才安装适配器，当前 QQ 没有端点模块，因此**永远不安装** |
| 端点模块 | 只有 [`src/providers/endpoints/netease.mjs`](../../src/providers/endpoints/netease.mjs) | QQ 没有对应文件 |
| UI | [`src/ui/client/panel.mjs`](../../src/ui/client/panel.mjs) 第 70、143 行 | 平台行已渲染，文案写着「QQ 接入暂缓」 |
| 文档 | [P4-P5](P4-P5-platforms.md) | 明确记录「未与真实 QQ 音乐通信过」，接口形状全部未确认 |

现有 `qq.mjs` 的解析假设与本次查到的真实形状**不一致**，实现时必须改：

| 现有假设 | 真实形状（据上游包文档与同宿主插件用法） |
|---|---|
| 响应包在 `req_0.data` | 包已归一化，直接给 `items`／`songs`／`playlist` |
| 扫码状态码 65／66／67 | `800` 过期、`801` 等待、`802` 已扫、`803` 成功（与网易云同码） |
| 播放地址字段 `purl` + `expiresIn` | `data.playUrl[<mid>].url`，另有 `preview`、`source.kind/protocol/cdn` |
| 曲目 ID 只有 `songmid` | `mid` 为主，`songmid` 也出现；`toTrack` 已同时接受 |

## 2. 两条路线

### 2.1 官方：QQ 音乐开发者平台

`open.y.qq.com` 与 `developer.y.qq.com` 都会跳转到 `y.qq.com/music_developer/`，页面自述「面向开发者，提供合法海量热门的音视听资源及播控能力……通过 API/SDK 的接入方式，实现在软件应用/智能硬件/公播等多场景的音乐能力落地」。

腾讯音乐官方示例仓库 [`tencentmusic/QQMusic_Innovation_QPlay_OpenAPI_Demo`](https://github.com/tencentmusic/QQMusic_Innovation_QPlay_OpenAPI_Demo)（Apache-2.0）显示实际接入需要：

- `OPI_APP_ID`、`OPI_APP_KEY`、`OPI_APP_PRIVATE_KEY`；
- 硬件设备注册／登录（`DEV_AUTH_*`、`OPI_DEVICE_ID`）；
- QQ 音乐 OpenID 登录（`QQMUSIC_OPENID_USERID`、`QQMUSIC_ACCESS_TOKEN`）。

**判断：** 这是合作方／商务通道，需要资质与密钥下发，个人维护的开源插件无法自助开通。**准入细则本次未核实**（开发者平台是单页应用，本机抓取只拿到跳转脚本），写「未验」而不是「不可能」。

### 2.2 社区：逆向接口包（事实标准）

社区包把 `c.y.qq.com`、`u.y.qq.com`、`graph.qq.com` 等分散端点、`comm` 参数、vkey 取链、扫码登录与设备身份封在内部，对外只暴露少量路由。本仓库对网易云已经采用同一模式（固定 `@neteasecloudmusicapienhanced/api@4.40.1`），QQ 沿用不会引入新的架构范式。

## 3. 候选包对比

数据采集于 2026-11-17（GitHub API、npm registry、npm downloads API）。

| 候选 | 许可 | 活跃度 | 月下载 | 形态 | 判断 |
|---|---|---|---|---|---|
| [`@yakult-green-tea/qq-music-api`](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api) `3.3.7` | MIT | 2026-11-16 推送；★29 | **25,500** | Koa 服务，根模块 require 即监听；另有 `/serverless`、`/mqtt` 导出 | **首选**：路由最全、文档与错误表最完整、有相容政策 |
| [`@sansenjian/qq-music-api`](https://www.npmjs.com/package/@sansenjian/qq-music-api) `2.6.0` | MIT | 2026-09-29 推送；★51 | 2,909 | Koa + **`/sdk` 函数式入口**（无需端口） | 备选：架构最贴合，但 SDK 未覆盖个人曲库 |
| [`qq-music-api`](https://www.npmjs.com/package/qq-music-api)（jsososo）`1.1.2` | **GPL-3.0** | 2024-06-25 推送；★1,636 | 535 | Express，`api(role, params)` | **排除**：GPL-3.0 与本仓库 MIT 冲突，且已停更约 29 个月 |
| [`L-1124/QQMusicApi`](https://github.com/L-1124/QQMusicApi) | **GPL-3.0** | 2026-11-07 推送；★537 | — | Python | **排除**：语言不符且 GPL |

补充信号：

- `@yakult-green-tea/qq-music-api` 依赖 `koa`、`axios`、`ws`、`zod`、`koa-router`、`koa-static`、`koa-bodyparser`；安装体积 1.98 MB／620 文件。
- 同宿主生态的 [`dsh-music-panel`](https://github.com/Aliboder/dsh-music-panel)（AGPL-3.0-only，0.36.2）在 `package.json` 里固定 `@yakult-green-tea/qq-music-api: 3.3.6`，与 `@neteasecloudmusicapienhanced/api: 4.41.1` 并列——说明「一个平台一个社区包」在这个宿主里已经跑通。
- **许可边界**：`dsh-music-panel` 是 AGPL-3.0，只可参考其依赖选择与路由名这类事实，不能复制其代码。

## 4. 推荐方案与架构落点

### 4.1 方案 A（首选）：Core 内嵌 worker + 回环端口

```text
Core 进程
 └─ qq 社区包适配层（新增，形如 netease 的 createCommunityTransport）
     ├─ Worker(thread)：设 PORT=<临时端口> → require 包 → 等 listening → 回报端口
     └─ role → HTTP 127.0.0.1:<port>/<route> → 归一化 → 交给 platform.mjs
```

理由：包在 require 时就监听，且配置拒绝 `port <= 0`，所以必须**先分配端口再加载**；放进 worker 可以在 Core 退出时整体终止，不污染主线程。同宿主插件采用的正是这一形状。

### 4.2 方案 B（备选）：`/sdk` 函数式调用

`import { search, getMusicPlay, getLyric, getLoginQr, checkLoginQr } from '@sansenjian/qq-music-api/sdk'`，全程无端口。代价：

- SDK 只导出搜索、取链、歌词、扫码；**个人歌库要走 `/services` 内部入口**，而该入口不在相容政策保护范围内；
- 维护者单人，月下载 2,909，样本量少一个数量级。

### 4.3 三处架构冲突

| 冲突 | 证据 | 处理 |
|---|---|---|
| 传输层只信任单一 origin | [`src/providers/transport.mjs`](../../src/providers/transport.mjs) 第 139–152 行 | QQ 不走 `createHttpTransport`，另写社区包适配层（与 `netease.mjs` 的 `createCommunityTransport` 同构） |
| 「不新增监听端口」 | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)「生产入口复用宿主认证路由，不新增监听端口」 | 该约束针对插件自身 RPC。QQ 上游端口应限定 `127.0.0.1`、随机、随 Core 生命周期起停；**这是需要用户确认的偏离**，不是默认允许 |
| 包体积与许可清单 | `package.json` 的 `files` 白名单、`scripts/dependency-notices.mjs`、[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) | 新增 7 个传递依赖与约 620 个文件，需重跑依赖清单、许可生成与实包白名单检查 |

## 5. 接口映射

上游路由取自该包 [使用文档](https://github.com/yakult-green-tea/qq-music-api/blob/HEAD/docs/README.md) 的「API 接口一览」。

| 我们的 role | 上游路由 | 备注 |
|---|---|---|
| `loginQr` | `GET /login/qr/key?channel=qq` → `GET /login/qr/create?key=&qrimg=1` | 返回 `data.unikey`、`data.qrimg`（base64）、`data.qrurl` |
| `loginPoll` | `GET /login/qr/check?key=` | `800/801/802/803`；另带 `failureHint`、`failureStage`、`retryAfterMs` |
| `accountInfo` | `GET /login/status`、`/user/detail` | 需登录 |
| `recentTracks` | **无对应路由** | 只有 `/user/listening-rank`（听歌排行，日／周／月／年）。**这是最大缺口** |
| `likedTracks` | `GET /user/liked-songs?limit=100&offset=` | 用 `more` 续页 |
| `playlists` | `GET /user/playlist` | `dirId === 201` 即「我喜欢」 |
| `playlistTracks` | `GET /user/playlist-detail?tid=&dirid=&offset=&limit=` | 支持本人不公开歌单 |
| `search` | `GET /search?keyword=&type=song&page=&limit=` | `limit` 默认 10、**上限 20**；搜不到回 200 + 空列表 |
| `resolve` | `GET /getMusicPlay/:songmid?quality=320` | 匿名通常 128；带会话 `best` 按 `FLAC → 320 → 128` 尝试 |
| `lyrics` | `GET /getLyric?songmid=` | 返回 `lyric` + `trans`（LRC 文本） |
| `recommendation` | `/user/daily-songs`、`/user/personal-fm`、`/user/guess-you-like`、`/song/similar` | 均需登录；可替换当前恒为 `unavailable` 的推荐能力 |

### 字段映射

| 我们的字段 | 上游字段 |
|---|---|
| `providerTrackId` | `mid`（`songmid` 同义） |
| `title` | `name` / `title` / `songname` |
| `artist`、`artists` | `singer[]` → `{ mid, name }`；`toTrack` 已接受 `singer` |
| `durationMs` | `interval`（秒）× 1000 |
| 封面 | `https://y.gtimg.cn/music/photo_new/T002R500x500M000<album.mid>.jpg` |
| 可用音质 | `file.size_128mp3 / size_320mp3 / size_flac / size_hires` |
| 付费标记 | `pay.payplay` |
| 播放地址 | `data.playUrl[<mid>].url`；`preview === true` 表示试听片段 |

## 6. 登录、凭据与会话

- **三个通道**：`qq`（手机 QQ 扫码，Node 下走 MQTT 长连接）、`wechat`（微信扫码）、`qqmusic`（QQ 音乐 App 扫码，需 MQTT）。能力以 `GET /login/channels` 为准。
- **凭据形态**：`uin=o123456789; qm_keyst=...`，可直接交给现有 DPAPI／Keychain 存储（`accountRef = fishfm/qq`），SQLite 仍只存引用。
- **设备名额**：新设备身份可能触发 `20279`，需在 QQ 音乐 App 的设备管理里清理旧设备；**不要反复删除设备文件或更换密钥**。
- **续期与登出**：`POST /login/refresh`、`/logout`。`platform.mjs` 现有的 `authorized / expired / revoked` 状态机可以直接复用。
- **错误语义**：`401` 表示未登录或凭证被拒（应清登录）；`502` 表示上游失败（**不应**清登录）；`429` 按 `retryAfterMs` 退避。与 [`mapTransportError`](../../src/providers/contract.mjs) 的现有映射基本对齐。

## 7. 播放链路

- 链接由上游返回，文档示例为 `https://...`；`source.cdn` 区分「上游自带主机／探测可用／未验证默认」。
- 我们的 [`MediaDownloads`](../../src/playback/media-download.mjs) 只发 `accept: */*`，**不带 Referer、不带 UA**（第 67 行）。QQ CDN 是否因此拒绝，**本次未验**。
- 文档明确警告：「同一个账号、同一首歌在 App 里能完整播放，通过本服务仍可能只能试听，或拿不到链接」。
- 因此实现时应：
  1. `resolve` 返回 `expiresAt`，播放前按需重取；
  2. **拒绝或明确标记 `preview === true`**，否则 30 秒试听会被计入有效收听与成长，违反 A10；
  3. 取不到链接归为 `media_unavailable`，不要归为 `provider_failure`。

## 8. 风险与合规

| 风险 | 说明 | 应对 |
|---|---|---|
| 非官方接口 | 违反平台条款的可能性由使用者承担；包 README 写「仅供学习，不可做商业用途」，与 MIT 正文存在张力 | 在 THIRD_PARTY_NOTICES 记录来源、版本、许可与范围；README 说明非官方 |
| 上游漂移 | `3.3.4` 移除 9 条路由、`3.3.5` 移除 17 条，**patch 版本内即含破坏性变更** | 固定精确版本（不用 `^`），升级前读 CHANGELOG |
| 账号风控 | 设备名额、`auth.account-restricted`、地区与会员限制 | 错误原样转述，不判定「不是会员」 |
| 试听冒充整曲 | `preview` 条目仍是有效 URL | 播放前检查 `preview`，试听不计成长 |
| 体积与依赖 | 7 个传递依赖、约 620 文件 | 重跑依赖清单、许可生成、实包白名单 |
| 端口 | 回环监听是新增行为 | 仅 `127.0.0.1`、随机端口、随 Core 起停；需用户确认 |

## 9. 待验证清单

按优先级，全部为**未验**：

1. 真实账号 `qq` 通道扫码 → cookie 落库 → 重启恢复。
2. `/getMusicPlay` 真实链接：协议、主机、是否需要 Referer／UA、vkey 有效期、`preview` 比例。
3. 我们的 `MediaDownloads`（无 Referer）能否直接下载该链接。
4. `/user/liked-songs` 分页、字段与 `dirId === 201` 的「我喜欢」。
5. `/search` 的 `limit` 上限与「200 + 空列表」的真实语义。
6. `/getLyric` 结构与现有 `normalizeNetEaseLyrics` 的复用边界。
7. `/user/daily-songs`、`/user/personal-fm` 的推荐形状能否直接进 discovery。
8. 设备名额与多实例并发。
9. 隔离 DSH profile 的安装、启用、RPC 与生命周期。
10. 日常 Desktop 的真实听音。

## 10. 若恢复优先级：实施顺序

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| P0 | 适配器形状对齐（扫码码值、播放字段、ID）+ 社区包适配层（worker）+ 登录 + `resolve` | 真实账号能扫码、能取到链接并播放 |
| P1 | 种子：`liked` → `playlist`；`recent` 明确 `unavailable`（或改用 `listening-rank`） | 导入数量与来源如实上报，降级标 `degraded` |
| P2 | 搜索 + 歌词 | 搜索、歌词与现有 UI 贯通 |
| P3 | 推荐接入 discovery | 能力从 `unavailable` 变为 `available` |
| P4 | UI 文案（[`panel.mjs`](../../src/ui/client/panel.mjs) 第 143 行）+ A01 双平台验收 | A01 从「未通过」升级需真实双平台证据 |

## 11. 本次实测与证据

本机只做了两个只读探针（2026-11-17），**不涉及账号、不写库、不改代码**：

| 探针 | 结果 |
|---|---|
| `GET https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data={req_0: music.search.SearchCgiService/DoSearchForQQMusicDesktop}` | HTTP 200，外层 `code: 0`，**`req_0.code: 2001`**，song／singer／album 列表全空 → 裸调用缺上下文，手写端点不可行 |
| `GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?...&format=json` | 主机可达，响应 `application/x-javascript;charset=utf-8`（JSONP）；本次工具按内容类型拒绝正文，**未取得结果**，只能证明可达 |

来源：

- [`@yakult-green-tea/qq-music-api`](https://github.com/yakult-green-tea/qq-music-api)：README、`docs/README.md`、`docs/errors.md`、`docs/compatibility.md`、`types/root.d.ts`、npm registry。
- [`@sansenjian/qq-music-api`](https://github.com/sansenjian/qq-music-api)：README、`src/sdk.ts`、`docs/api/user.md`。
- [`jsososo/QQMusicApi`](https://github.com/jsososo/QQMusicApi)：README、仓库元数据（GPL-3.0、最后推送 2024-06-25）。
- [`tencentmusic/QQMusic_Innovation_QPlay_OpenAPI_Demo`](https://github.com/tencentmusic/QQMusic_Innovation_QPlay_OpenAPI_Demo)：官方示例所需参数。
- [`Aliboder/dsh-music-panel`](https://github.com/Aliboder/dsh-music-panel)：`package.json` 依赖固定方式；AGPL-3.0，仅作事实参考。
- npm downloads API（近 30 天，2026-10-17–2026-11-15）。

**未做**：安装依赖、真实账号登录、真实播放、Referer／vkey 实测、官方平台准入核实、全量回归。本报告不改变 A01–A10 任何状态。

后续：模块划分、role 映射与网易云接口方案的逐项对照见 [QQ Provider 接入方案](../design/FEAT_QQ_PROVIDER.md)（提案，未实现）。
