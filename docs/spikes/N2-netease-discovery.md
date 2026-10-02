# N2 网易云真实候选来源

2026-10-02，Windows，固定 `@neteasecloudmusicapienhanced/api@4.40.1`（已有 MIT 依赖，无新增依赖）。现有 DPAPI 会话只读探针确认 `authorized`；没有覆盖生产账号/库或启动第二个 Core。

| 方法 | 真实响应 | 相对当前 100 首导入库的陌生数 | 用途 |
|---|---|---|---|
| `recommend_songs` | HTTP/API 200，`data.dailySongs` 34 首 | 34 | 本轮默认账号每日推荐来源 |
| `personal_fm` | HTTP/API 200，`data` 3 首 | 3 | 每日推荐失败/空结果时的备用来源 |
| `simi_song(id=1319639646)` | HTTP/API 200，`songs` 5 首 | 4 | N5 的单曲种子关系参考；本轮未接入自动种子推荐 |

接口依据是固定包 `module/recommend_songs.js`、`personal_fm.js`、`simi_song.js` 与真实响应。分别使用包内 `/api/v3/discovery/recommend/songs`、`/api/v1/radio/get`、`/api/v1/discovery/simiSong` 路径，不复制包内实现或增加服务。

同一生产 Provider 的规范化探针再次返回 34 首；候选《只筝朝夕》ID `2150895252`，时长 246547ms，`resolve` 返回真实资源并带约 1200 秒有效期。只记录是否可解析，不保存 URL/凭据。取得候选和解析成功尚不等于真实听到声音，播放验收将在 N3 现场闭环补充。

实现：NetEase 新增可选 `getDiscoveryTracks({limit,signal})`，返回 Track 数组并附 `discovery` 来源、取得时间和 6 小时 TTL；每日推荐/私人 FM 来源分别为 `netease_daily` / `netease_personal_fm`，没有伪装成 Agent 独立推荐风格。缺接口、未登录、失败和空数组有明确区分。数量限 1–200，平台真实数量不足时不补造。

32 项 Provider/协调器/社区请求专项通过，覆盖规范化、去重、来源、请求计数、每日失败回退、取消、数量限制与错误结构。QQ 现有能力保留，不因本轮缺推荐而撤销支持。
