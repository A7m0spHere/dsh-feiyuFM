# QQ 音乐 Provider 接入方案（提案）

- 状态：**提案，未实现、未联调**。依据 [N8 调研](../spikes/N8-qq-integration-options.md)。
- 目标：在现有 Provider 契约下接入 QQ 音乐，覆盖登录、导入、搜索、播放、歌词、推荐。
- 非目标：QQ 音乐写入（喜欢／收藏）、音乐云盘、MV、评论、官方开放平台。
- 关系：本文件是设计提案，现行行为以 [MVP](../MVP.md) 与 [控制契约](../CORE_CONTRACT.md) 为准，状态只在 [PROJECT_PLAN](../PROJECT_PLAN.md) 维护。

## 一、总体思路

复用现有共享状态机，**只新增一个 transport 实现并修正 parse**：

```text
createPlatformProvider（src/providers/platform.mjs，不改）
  ↑ transport                          ↑ parse
  │                                    │
  ├─ 网易云：createCommunityTransport   ├─ netease.mjs 的 parse
  │    + createHttpTransport(单 origin) │
  └─ QQ：qq-transport.mjs（新增）        └─ qq.mjs 的 parse（修正）
       └─ qq-upstream.mjs → Worker → 127.0.0.1:<port> → 社区包
```

这正是 [`platform.mjs`](../../src/providers/platform.mjs) 开头写明的设计意图：平台差异只允许出现在 `roles`（有哪些角色、怎么调）和 `parse`（响应怎么归一化）两处。QQ 的接入不触碰账号状态机、能力诚实性、来源降级链和错误映射。

## 二、模块设计

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/providers/qq-upstream.mjs` | 新增 | 分配回环端口、拉起 Worker、等待 listening、代理 HTTP 调用、`close()` 终止 |
| `src/providers/qq-worker.mjs` | 新增 | Worker 入口：设 `PORT`／`HOST`，`require` 社区包，等 `server` listening 后回报端口 |
| `src/providers/qq-transport.mjs` | 新增 | role → 上游路由映射，`request({role, params, signal})` → `{status, body}`，`useSecret`／`jar` |
| [`src/providers/qq.mjs`](../../src/providers/qq.mjs) | 修改 | 修正扫码码值、播放字段、ID；种子顺序改 `liked → playlist`；加 `lyrics`、`getDiscoveryTracks`、`getUserPlaylists` |
| [`src/lyrics.mjs`](../../src/lyrics.mjs) | 修改 | 新增 `normalizeQQMusicLyrics`（QQ 给 LRC 文本 + `trans`，与网易云结构不同） |
| [`src/core-host.mjs`](../../src/core-host.mjs) | 修改 | `ProviderRegistry.close()` 调 `provider.dispose?.()`；`close()` 里调用 |
| [`bin/fishfm-core.mjs`](../../bin/fishfm-core.mjs) | 修改 | `adapters` 增加 `qq: { transport: createQQCommunityTransport(...) }` |
| `package.json`／`npm-shrinkwrap.json` | 修改 | 新增 `@yakult-green-tea/qq-music-api` 固定版本 |

**不新增** `src/providers/endpoints/qq.mjs`：QQ 没有需要自建的端点，全部角色由社区包承担。

## 三、关键决策

| 编号 | 决策 | 理由 | 被否方案 |
|---|---|---|---|
| D1 | 用社区包，不自建端点 | 裸调 `musicu.fcg` 实测 `req_0.code = 2001`，缺 `comm`／签名上下文 | 手写端点：维护成本高、上游一变就废 |
| D2 | Worker 线程 + `127.0.0.1` 临时端口 | 包在 require 时即监听且拒绝 `port <= 0`；Worker 可整体终止、崩溃不拖垮 Core | 进程内 require：Core 进程多一个监听器且不可重启 |
| D3 | 拒绝 `preview === true` 的播放结果 | 试听片段也是有效 URL，放行会让 30 秒试听计入有效收听，违反 A10 | 放行并标记：Core 侧还要改成长判定，改动面更大 |
| D4 | `recent` 标 `unavailable`，种子改 `liked → playlist` | 社区包没有「最近播放」路由，只有 `/user/listening-rank`（听歌排行） | 用 `listening-rank` 冒充最近播放：会把「最常听」说成「最近听」，违反来源诚实 |
| D5 | 固定精确版本，不用 `^` | `3.3.4`／`3.3.5` 在 patch 内各移除 9／17 条路由，SemVer 不严格 | 跟随 `latest`：升级即可能断 |
| D6 | 不启用包的会话仓库，Cookie 由我们持有并逐次传入 | 与网易云一致：SQLite 只存引用，密钥进 DPAPI／Keychain | 用包自带会话文件：多一份密钥文件，脱离现有凭据边界 |
| D7 | 不改 `platform.mjs` | 双平台必须共用同一状态机，否则必然漂移 | 给 QQ 单独写状态机：P4 重构已经拒绝过这条路 |

## 四、role → 上游路由

| role | 上游路由 | 说明 |
|---|---|---|
| `loginQr` | `GET /login/qr/key?channel=qq` → `GET /login/qr/create?key=&qrimg=1` | transport 内部合成两次调用，返回 `{ data: { unikey, qrimg, qrurl } }` |
| `loginPoll` | `GET /login/qr/check?key=` | `800` 过期／`801` 等待／`802` 已扫／`803` 成功；成功时 `cookie` 在正文 |
| `accountInfo` | `GET /login/status` | 形状待实测 |
| `recentTracks` | — | **无对应路由**，`capability.unavailable` |
| `likedTracks` | `GET /user/liked-songs?limit=100&offset=` | `more` 续页 |
| `playlists` | `GET /user/playlist` | `dirId === 201` 即「我喜欢」 |
| `playlistTracks` | `GET /user/playlist-detail?tid=&dirid=&offset=&limit=` | 支持本人不公开歌单 |
| `search` | `GET /search?keyword=&type=song&page=&limit=` | `limit` 上限 20 |
| `resolve` | `GET /getMusicPlay/:songmid?quality=320` | 取 `data.playUrl[mid]` |
| `lyrics` | `GET /getLyric?songmid=` | `lyric` + `trans` |
| `dailyRecommendations` | `GET /user/daily-songs` | 推荐主来源 |
| `personalRecommendations` | `GET /user/personal-fm` | 推荐备来源 |
| `similarRecommendations` | `GET /song/similar` | 按种子曲扩展 |

响应形状按上游文档与同宿主插件用法推定，**全部待真实账号实测**；实测不符时只改 `qq-transport.mjs` 与 `qq.mjs` 的 `parse`，不动其他模块。

## 五、数据与字段映射

| 契约字段 | 上游字段 | 备注 |
|---|---|---|
| `providerTrackId` | `mid`（`songmid` 同义） | `toTrack` 已同时接受 |
| `title` | `name` / `title` / `songname` | |
| `artist`、`artists` | `singer[]` → `{ mid, name }` | `toTrack` 已接受 `singer` |
| `durationMs` | `interval` × 1000 | 上游是秒 |
| 封面 | `https://y.gtimg.cn/music/photo_new/T002R500x500M000<album.mid>.jpg` | 只在 UI 用 |
| 可用音质 | `file.size_128mp3/320mp3/flac/hires` | 用于选 `quality` |
| 付费标记 | `pay.payplay` | 只作事实，不作判定 |

## 六、登录、凭据与会话

- 通道 `qq`（手机 QQ 扫码）；`wechat`、`qqmusic` 作为可选通道保留，能力以 `GET /login/channels` 为准。
- 成功后 Cookie（`uin=o…; qm_keyst=…`）走现有 `createPlatformCredentials`（Windows DPAPI／macOS Keychain），`accountRef = fishfm/qq`，SQLite 只存引用。
- `platform.mjs` 现有的 `authorized / expired / revoked` 状态机直接复用；`restore()` 打 `/login/status` 校验。
- 续期：不主动调 `/login/refresh`；收到 `401` 即置 `expired` 并要求重新扫码。若实测 Cookie 寿命过短，再评估接入刷新。

## 七、播放与试听拦截

```text
resolve(track)
  → GET /getMusicPlay/<mid>?quality=320
  → data.playUrl[mid] = { url, preview, source }
  → preview === true  → throw MusicError('media_unavailable', '仅提供试听片段')
  → url 为空          → throw MusicError('media_unavailable', <上游 reason>)
  → 否则              → { handle: url, expiresAt: null }
```

- `expiresAt` 上游不提供，先返回 `null`；播放失败按 `media_unavailable` 处理，不自动重取（与 R4 的 12 秒预算一致）。
- [`MediaDownloads`](../../src/playback/media-download.mjs) 目前只发 `accept: */*`。若实测 CDN 要求 Referer／UA，**只在 Playback 侧按 provider 增加请求头**，不把 Cookie 带进媒体请求。
- 试听拦截是 A10 的硬边界：宁可少播一首，也不把试听记成有效收听。

## 八、错误映射

| 上游 | 我们的错误 | 是否清登录 |
|---|---|---|
| HTTP `401`、`auth.credential-invalid` | `login_required` | 是 |
| HTTP `422` | 空结果（不是错误） | 否 |
| HTTP `429` | `rate_limited`，带 `retryAfterMs` | 否 |
| HTTP `502`、`upstream-*` | `provider_failure`，`retryable` 按 `retryable` 字段 | **否** |
| `auth.device-limit`（`20279`） | `login_required` + 固定中文提示「设备数已满，请在 QQ 音乐 App 移除旧设备」 | 否 |
| `url_unavailable` | `media_unavailable` | 否 |

`mapTransportError` 已覆盖 401／403／404／429／5xx／超时，QQ 只需补 `kind`／`errorKey` 的细分。

## 九、与网易云接口方案逐项对照

| 维度 | 网易云（现状） | QQ（本方案） |
|---|---|---|
| 社区包 | `@neteasecloudmusicapienhanced/api@4.40.1`（MIT） | `@yakult-green-tea/qq-music-api@3.3.7`（MIT） |
| 月下载量 | 32,066 | 25,500 |
| 包形态 | 纯函数库，Core 进程内 `require` | Koa 服务，`require` 即监听 |
| 进程模型 | 与 Core 同进程 | Worker 线程 + `127.0.0.1` 临时端口 |
| 传输层 | `createCommunityTransport` 包一层 `createHttpTransport` | 新增 `qq-transport.mjs`，不经 origin 白名单 |
| 端点来源 | **混合**：账号／种子／推荐／歌词走包；`search`／`resolve` 走 [`endpoints/netease.mjs`](../../src/providers/endpoints/netease.mjs)（2026-09-27 实测） | **单一**：全部走包，无端点模块 |
| 登录 | 二维码 `type=3`；`801/802/803` | 二维码 `channel=qq`；`801/802/803`（同码） |
| 凭据 | `MUSIC_U` Cookie → DPAPI／Keychain | `uin` + `qm_keyst` Cookie → 同一存储 |
| 种子顺序 | `recent → liked → playlist`（`likelist` + `song_detail` 两步） | `liked → playlist`（`recent` 无接口） |
| 搜索 | 自建 `GET /api/search/get/web` | 包内 `GET /search`（`limit ≤ 20`） |
| 播放 | `POST /api/song/enhance/player/url`，`expi` 秒 | 包内 `GET /getMusicPlay/:mid`，`preview` 标记 |
| 歌词 | `lyric` 模块 + `normalizeNetEaseLyrics` | `/getLyric` + 新增 `normalizeQQMusicLyrics` |
| 推荐 | `recommend_songs` + `personal_fm` + `simi_song` | `daily-songs` + `personal-fm` + `song/similar` |
| 错误来源 | HTTP 状态 + 平台 `code`（`communityFailure`） | HTTP 状态 + `kind`／`errorKey`／`upstreamCode` |
| 契约扩展 | `getUserPlaylists`、`getDiscoveryTracks` | 同两个扩展 |
| 新增监听端口 | 无 | **有**（需用户确认） |
| 包体积 | 已计入 | 约 +620 文件、+7 个传递依赖 |
| 上游稳定性 | 固定版本 | 固定版本；`3.3.x` 在 patch 内移除过路由 |
| 验证状态 | 真实账号、播放、歌词、推荐均已在日常使用 | **全部未验** |

三点结论：

1. **架构不变。** 两个平台继续共用 `createPlatformProvider`，QQ 的差异被限制在 transport 与 parse，与 P4 重构时的设计一致。
2. **QQ 比网易云少一条路径。** 网易云是「社区包 + 自建端点」的混合体，QQ 是全包；代价是 QQ 把上游形状完全交给第三方维护，收益是不用再维护 `comm` 与签名。
3. **QQ 比网易云多一个进程内组件。** 网易云不需要端口，QQ 需要；这是本次唯一需要用户拍板的架构偏离。

## 十、测试与验证计划

| 层 | 内容 | 判据 |
|---|---|---|
| 单元 | `qq-transport` 的 role→路由映射、Cookie 传递、错误映射 | 假上游，全部离线 |
| 单元 | `qq.mjs` 的 parse：扫码四态、播放三态（有链／试听／空）、字段映射 | 固定 JSON 夹具 |
| 生命周期 | Worker 起停、端口释放、Core `shutdown` 后无残留线程 | 假 Worker 入口 |
| 契约 | `runProviderConformance` 对 QQ 跑一遍 | 缺能力必须报原因，不得返回空列表 |
| 回归 | 现有 `test/*.test.mjs` 全套串行 | 不低于当前基线，新增用例先败后过 |
| 真实 | 隔离 DSH profile：扫码 → 导入 → 搜索 → 播放 → 歌词 → 推荐 | 每步留证据，失败单列 |
| 日常 | 原生 Desktop 听音、暂停、换曲 | 用户确认 |

## 十一、发布与打包影响

- `dependencies` 增加 1 个直接依赖、7 个传递依赖；`npm-shrinkwrap.json` 更新。
- `scripts/dependency-notices.mjs` 重新生成 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)，记录来源、版本、许可与「仅供学习」表述。
- `package.json` 的 `files` 已含 `src/**/*.mjs`，新文件自动随包。
- `npm run check` 模块数由 200 增至约 204；`npm run verify:package` 的文件数与白名单需重跑。
- 版本号建议 minor：`0.1.2 → 0.2.0`，因为新增平台能力。

## 十二、分阶段与判据

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| P0 | `qq-upstream` + `qq-worker` + `qq-transport` + parse 修正 | 离线夹具全过，Worker 起停无残留 |
| P1 | 登录与凭据 | 真实扫码 → Cookie 落库 → 重启后仍 `authorized` |
| P2 | 种子与搜索 | 导入数量与来源如实上报；`recent` 报 `unavailable` |
| P3 | 播放与试听拦截 | 真实取链可播；试听被拒；失败归 `media_unavailable` |
| P4 | 歌词与推荐 | 歌词逐行显示；推荐能力从 `unavailable` 变 `available` |
| P5 | UI 与验收 | 移除「QQ 接入暂缓」文案；A01 按真实双平台证据评估 |

## 十三、需要拍板的问题

1. **是否接受回环端口。** 不接受就只能退回 `@sansenjian/qq-music-api/sdk`（无端口，但个人曲库要下探内部入口）。
2. **是否接受 +620 文件的包体积。** 不接受则 QQ 只能作为可选依赖，不随主包发布。
3. **试听是否一律拒绝。** 拒绝更保守；放行需要同时改成长判定。
4. **是否现在就做。** 当前 A01 仍缺 QQ，但 #11 真实试用仍是 0 人，优先级由用户决定。

返回 [设计索引](README.md) · [N8 调研](../spikes/N8-qq-integration-options.md) · [开发状态](../PROJECT_PLAN.md)
