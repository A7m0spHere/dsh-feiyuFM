# P2 网易云适配器：实现与验证

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0（**离线**，无网络、无真实账号）。
- 状态：**适配器自身行为已实现并通过 14 项测试**；**未与真实网易云服务通信过任何一次**。平台的线上接口形状仍属未验证，P0-02 与 P3 必须用用户账号确认后才能声称可用。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) P2；验收关联 A01（真实平台播放，尚未达成）、A02（导入来源与数量）。

## 这一轮刻意没有做什么

按 `AGENTS.md`「不提前生成空代码包、不承诺未经实测的兼容性」，本模块**不声称**任何具体接口 URL、参数名或响应字段是"网易云的真实接口"。做法是：

- 平台差异全部收在 **transport**（`request({ role, params, signal })`）里，角色名是**语义**（`loginQr` / `recentTracks` / `songUrl` …），不是 URL；
- 适配器只实现**与平台无关就必须成立**的部分：账号状态机、能力诚实性、来源降级、响应归一化、错误分类、句柄不落库；
- 测试用假 transport 提供"平台形状"的响应，因此它验证的是**适配器的归一化与判定逻辑**，不是网易云的协议。这一点在测试文件与本文都写明。

## 交付物

| 文件 | 职责 |
|---|---|
| [`src/providers/contract.mjs`](../../src/providers/contract.mjs) | 规范化契约 + **共享一致性检查**（P2/P4 必须共用同一组）+ 归一化 + 错误映射 |
| [`src/providers/netease.mjs`](../../src/providers/netease.mjs) | 网易云适配器：账号生命周期、能力状态、来源降级、搜索、解析 |
| [`src/contracts.mjs`](../../src/contracts.mjs) | `MusicError` 增加 `details`（记录降级/尝试轨迹）与 `cause` 透传 |
| [`test/providers.test.mjs`](../../test/providers.test.mjs) | 14 项：一致性检查、登录/过期/登出、凭据边界、来源降级、解析、错误映射 |

## 共享契约检查（路线明确要求 P2 与 P4 用同一组）

`runProviderConformance({ provider, name, fixture })` 对任何适配器跑同一批检查：

1. 暴露必需方法（`getAccount`/`getCapabilities`/`resolve`/`search`/`getSeedTracks`）；
2. 账号状态在允许集合内，且**没有凭据时不得声称 authorized**；
3. **缺失能力不能伪装成空结果**——未登录时 `search` 必须抛出带 `code` 的 `MusicError`；
4. 导入必须报告**真实使用的来源**与**真实数量**（`imported === tracks.length`）；
5. `resolve` 返回 handle，且 handle **不得出现在持久化存储里**；
6. 登出后凭据引用必须消失。

无账号时无法运行的检查报告为 **skipped 并附原因**，绝不记为 passed。

## 账号与凭据边界（对应 P0-06 的结论）

- 二维码登录：`beginLogin`（key 只在内存）→ `pollLogin` 轮询；**确认后会话材料直接交给凭据存储**，调用方拿不到，也不写 SQLite。
- SQLite 只存 `credential_references`：`credential_ref = fishfm/netease` + `state`。测试断言 `credential_references` 全表 dump 与 core state 中**都不含**会话字符串。
- `restore()` 会向平台校验；401/403 时把引用标为 `expired` 并如实报告 `expired`，而不是继续假装已登录。
- `logout()` 同时删除凭据与其引用。

## 来源降级（对应 A02）

按 `recent → liked → playlist` 顺序尝试，返回**实际成功**的来源：

- 近期可用 → `available`
- 近期失败但收藏可用 → `degraded` 且 `reason` 写明"近期播放不可用，改用 liked"；**绝不会标成近期播放**
- 全部失败 → 抛 `provider_failure`（`retryable`）并在 `details.attempts` 里带上三次尝试的原因；能力状态转为 `unavailable` 并携带原因

`attempts` 记录**成功的那次**，因为审核降级路径时需要看到完整轨迹。

## 解析与错误分类

- `resolve(track, { signal, version })` → `{ handle, expiresAt, version }`；`expiresAt` 由平台 `expi`（秒）推导。
- 有曲目但**拿不到可播 URL**（会员/地区限制）→ `media_unavailable`（**不可重试**），与网络故障区分开。
- transport 错误统一映射：401/403 → `login_required`（不可重试）、429 → `rate_limited`（可重试）、5xx/超时 → `provider_failure`（可重试）。

## 本轮修掉的真实缺陷

1. **`MusicError` 丢弃结构化信息**：只能带 `retryable`，导致"三次尝试的失败原因"无法传给调用方。已支持 `details` 与 `cause`，降级原因可审核。
2. **导入失败后能力状态说谎**：全部来源失败时，`seed` 能力仍报 `available` 且理由是"no import has run yet"——**明明跑过并且失败了**。现在报 `unavailable` 并携带真实原因。
3. **QQ 的 `songmid` 不被识别**（共享归一化缺字段）：P4 会踩到。已加入 `songmid`/`mid` 兼容。
4. 一致性检查自身把**账号对象**当成凭据键传给 SQLite，被解析为命名参数而报 `Unknown named parameter 'status'`。已改为用 provider 名。

## 仍未验证（必须如实标注）

- **与真实网易云的任何一次通信**：未做。二维码接口、轮询返回码、`recentTracks`/`likedTracks`/`playlists`/`search`/`songUrl` 的真实 URL、参数与响应字段**全部未确认**。当前代码对响应做了多种形状的兼容猜测，但这**不等于**猜对了。
- **扫码登录**：需要一个可用账号；按 `PHASE_0` 的约定由用户完成扫码，且不需要向项目提供明文 Cookie。
- **会员/版权曲目的真实行为**：`media_unavailable` 的分类逻辑已实现，但真实平台在何种情况下返回何种响应未验证。真实播放链路**不能算通过**。
- **推荐能力**：显式声明为 `unavailable`（未实现），因此 T2 的探索池在接入前恒为空——这是诚实状态，不是 bug。
- **跨设备/长期会话**：`expiresAt`、凭据刷新与跨设备同步（P0-06 已指出不能同步 DPAPI 密文）均未实验。