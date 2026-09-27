# P4 QQ 与 P5 双平台协调：实现与验证

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0（**离线**，无网络、无真实账号）。
- 状态：**适配器与协调逻辑已实现，18 项测试通过（9 QQ + 9 协调）**；**未与真实 QQ 音乐通信过**，接口形状仍属未验证（P0-03/P3）。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) P4、P5；验收关联 A01（未达成）、A02、A10。

## 一次重构：两个平台共用一套状态机

P2 的适配器原本把账号状态机、能力报告、来源降级、错误映射都写在 `netease.mjs` 里。做 P4 时若照抄一遍，两个平台必然会各自漂移，而路线明确要求「P2 和 P4 都必须使用同一组规范化契约检查」。因此抽出：

| 文件 | 职责 |
|---|---|
| [`src/providers/platform.mjs`](../../src/providers/platform.mjs) | **共享状态机**：账号生命周期、能力诚实性、来源降级链、搜索、解析、错误映射 |
| [`src/providers/netease.mjs`](../../src/providers/netease.mjs) | 只剩网易云特有部分：角色与响应解析器配置 |
| [`src/providers/qq.mjs`](../../src/providers/qq.mjs) | 同上，QQ 特有部分 |
| [`src/providers/coordinator.mjs`](../../src/providers/coordinator.mjs) | P5：双平台状态、发现池合并、按本平台解析、种子导入汇总 |

平台差异被限制在两处：**roles**（有哪些角色）与 **parse**（响应如何归一化）。`parse` 就是"未验证的平台知识"的集中地——这里只保证：无论平台怎么回答，适配器都必须如实报告账号状态、能力与错误。

重构后网易云的 14 项测试**全部原样通过**（仅把 transport 角色名从 `songUrl` 改为语义化的 `resolve`）。

## QQ 特有行为（P4）

- 曲目 ID 是 `songmid`（共享归一化已支持 `songmid`/`mid`）。
- 播放地址是**限时 key**（`purl` + `expiresIn`），过期时间被跟踪。
- **近期来源失败只降级来源，不撤销 QQ 支持**（`AGENTS.md` 明文要求）：`recent → liked → playlist` 依次尝试，实际用哪个就报哪个，并标 `degraded`。测试专门断言"QQ 仍在工作、账号仍 authorized、能力状态是 degraded 而来源不是 recent"。
- QQ 的中文措辞出现在下降级理由里（"Recent listening was unavailable, so liked was used instead"），使它不可能被误认成近期播放。

## 双平台协调（P5）

| 规则 | 实现 | 测试 |
|---|---|---|
| 曲目永远属于它来自的平台 | 发现池按 provider 分别收集；平台返回别家曲目直接判失败 | ✅ |
| 一个平台不可用要**点名说原因**，而不是当作"没有新歌" | `collectDiscovery` 记 `attempts`，空池时返回合并原因 | ✅ |
| 未安装适配器 ≠ 找不到音乐 | `describePlatforms` 区分 `installed: false` 与账号状态 | ✅ |
| 解析**只用曲目自己的平台**，不回退到另一平台 | `resolveOnOwnPlatform`；QQ 未登录不影响网易云播放 | ✅ |
| 一个平台失败是**部分降级**，不是整体失败 | `summarizeSeedRuns` 给 `partial` 与逐平台来源 | ✅ |
| 推荐能力缺失要报告，不能伪装成空列表 | 能力状态不是 available/degraded 时记为不可用并附原因 | ✅ |

## 本轮修掉的真实缺陷

**`FakeProvider` 与真实适配器接口不一致**：真实适配器是"一个平台一个实例"，注册表调用 `adapter.getAccount()` **不传参数**；而测试替身要求传 provider 名，于是注册表拿到的是 `undefined`——**账号状态整个丢失**。这正是"测试替身与真实契约不一致"会掩盖产品缺陷的典型例子：如果只有替身被测过，双平台状态永远显示不出来。已让替身在构造时绑定平台，与真实契约一致。

## 仍未验证（必须如实标注）

- **与真实 QQ / 网易云的任何一次通信**：未做。QQ 的 `qrsig`/`ptuiCB` 状态码、`purl` 字段、`songmid`、播放列表字段名**全部未确认**；网易云同理（见 [P2 证据](P2-netease.md)）。
- **真实登录**：两个平台都需要用户扫码（P0-02/P0-03 约定不需要用户提供明文 Cookie）。
- **真实播放链路**：**不能算通过**；真实音频、会员/版权限制、限时 key 过期后的重取都未验证。
- **推荐接口**：两个平台都显式 `unavailable`，因此 T2 的发现池在接入前恒为空——这是诚实状态。
- **跨平台同一首歌**：不做合并（按 MVP 要求），但也意味着同一首歌在两个平台会各占一条环境记录，实际体验待真实数据检验。
- **双平台同时登录**的长期运行、凭据刷新与退出，未实验。