# I1 DSH 适配层：实现与验证

- 日期 / 环境：2026-09-27，Windows 11。真实宿主：隔离 `DSH_HOME` + `--from-default-profile web` 生成的 profile，宿主为 `0.1.7-rc.2`（CLI 启动，Node 24.14.0）。
- 状态：**插件在真实宿主中激活、拥有独立 Core 进程、停用即停止**已实测；**尚未在 Electron desktop profile 中激活**（安装需用户经 Plugin Manager 操作），真实平台事件（用户对话产生的事件）仍未观察。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) I1；验收关联 A04/A08/A09。前置 P3/T2 尚未完成，因此本层先落地可验证的接口与门控，不包含人格决策。

## 交付物

| 文件 | 职责 |
|---|---|
| [`index.js`](../../index.js) | 插件入口：`apply(ctx, config)`、`inject`、按宿主方式启动 Core、失败只报告不抛出 |
| [`cordis.patch.yml`](../../cordis.patch.yml) | bundle 层：插入 `id: fishfm` 行 |
| [`package.json`](../../package.json) | bundle 清单：`dsh.bundle.patch`、`exports`、`meta` 展示信息 |
| [`src/core-host.mjs`](../../src/core-host.mjs) | 独立 Core 工作进程：队列/库/播放 + 版本化 JSON 行协议 + 事件门控 |
| [`bin/fishfm-core.mjs`](../../bin/fishfm-core.mjs) | 插件启动的入口（`--db`、`--playback real|fake`、`--provider real|fake`） |
| [`src/dsh-adapter.mjs`](../../src/dsh-adapter.mjs) | 桥接：CoreBridge（进程与协议）+ 工具/斜杠命令/事件监听注册 |
| [`test/core-host.test.mjs`](../../test/core-host.test.mjs)、[`test/dsh-adapter.test.mjs`](../../test/dsh-adapter.test.mjs)、[`test/plugin-bundle.test.mjs`](../../test/plugin-bundle.test.mjs) | 20 项离线测试 |

## 真实宿主实测

安装（与 Plugin Manager 同一条 pnpm 路径）：

```text
dsh plugin --profile f1probe add D:\AI项目\dsh-音乐
+ dsh-feiyufm-core link:D:/AI项目/dsh-音乐
profile 的 bundles: dsh-base, dsh-web-app, @local/fishfm-p0-desktop-probe, dsh-feiyufm-core
```

启动后（`dsh --profile f1probe --no-open --port 19401`）：

| 观察 | 结果 |
|---|---|
| 插件激活 | 宿主日志**无** `1 entry did not activate`（修复前正是该条 + `TypeError: … reading 'validate'`） |
| 拥有的 Core 进程 | `node bin/fishfm-core.mjs --playback real --provider real`，PID 35740，**父进程是 DSH 宿主 36048** |
| 停用插件（profile patch 写 `- id: fishfm` / `disabled: true`） | Core 进程消失，**宿主仍在 19401 服务** |
| 重新启用 | 新的 Core 进程（PID 18704）挂回同一宿主，无警告 |
| 直接杀掉宿主 | 无残留 Core 进程 |

前两项与后两项分别对应 A08 的「停用后停止音乐、DSH 继续工作」和「宿主异常时不留下孤儿进程」。

## 本轮修掉的两个真实激活缺陷（只有跑真实宿主才会暴露）

1. **`Config` 必须是 schema，不能是普通对象**。首版导出普通对象作为 `Config`，cordis 在校验配置时抛 `TypeError: Cannot read properties of undefined (reading 'validate')`，插件整条不激活。改为不声明 `Config`（可选），部署参数在 `apply` 内按默认值合并。
2. **未注入的服务属性一访问就抛错**。`ctx.tools` / `ctx.commands` 必须经 `ctx.inject([...], cb)` 进入；`ctx.commands?.register` 这种可选链**不能**避免抛错（与 P0-01 探针踩到的是同一条规则）。插件因此声明 `inject = ['tools']`，命令注册走 `ctx.inject(['commands'], …)`，profile 没有命令服务时只少斜杠命令、不会整条失效。

另修掉一处产品级默认值错误：Core 工作进程原先把 `FakeProvider` 当默认 provider，导致「没有平台适配器时点歌也会成功」。现在默认是空的 `ProviderRegistry`，解析失败如实返回 `provider_unavailable`；假 provider 必须显式 `--provider fake`。

## 事件门控（对应 A09「不增加背景模型请求」）

- 只映射 `turn/end`（可触发一次自主选歌）、`turn/start`、`tool/call`、`tool/result`；其余事件（含不存在的 `idle`、`task_phase_change`）一律忽略，不猜工作内容。
- 一次自主选歌只发生在 `turn/end`，且**仍受暂停约束**：新建 Core 默认暂停，`turn/end` 不会自动开始播放（测试已断言）。
- 适配层不注册任何会向模型注入上下文的扩展点，也不产生 LLM 请求；工具与命令只在用户显式调用时执行。
- 静态工具描述是固定成本（3 个工具、3 个命令），符合 MVP「新增 LLM 请求为 0 ≠ 零 token」的区分，实测请求计数留待 R2。

## 仍未验证

- **Electron desktop profile 中的激活**：仍需用户经 Plugin Manager 安装（CLI 拒绝管理该 profile，见 [P0-01](P0-01-dsh.md)）。
- **真实用户对话事件**：本轮的 `session/event` 由合成事件驱动；真实会话里的 `turn/end` 频率与并发会话行为待观察。
- **多 Session 活动上下文**：当前只有一个 Core 与一条队列，Session 优先级尚未实现（属 P5/T2 之后的 U1/I1 收尾）。
- **真实平台解析**：`--provider real` 目前必然 `provider_unavailable`，要等 P2/P4。

## 2026-09-28：DSH `0.2.0-rc.1` 接口复核

本机 PHL 管理实例使用 DSH `0.2.0-rc.1`、Node `24.21.0`，符合项目 `package.json` 的 `>=24.14.0 <25` 范围。当前官方文档仍使用 bundle patch、Cordis 插件入口、工具输出 schema 和 `session/event`；没有发现会破坏本适配层的 API 变化。工具执行需接收 DSH 的 `exec.signal`：只读状态调用现在可响应中止，播放命令在发送前检查中止，发送后等待 Core 确认以避免遗漏已接受动作。

按用户要求把本仓库通过 `dsh plugin --profile web add <本仓库目录>` 安装到该 PHL 实例。profile bundle 清单和 `--dump-config` 均出现 FishFM；运行中的 DSH Web 服务保持响应，宿主启动了该插件拥有的独立 Core 进程。`test/dsh-adapter.test.mjs` 9 项通过。最新版的工具实际调用、插件卸载、desktop profile、真实会话事件和音乐平台播放仍未验。
## 关于 DSH 源码可读性的一处更正（2026-09-27 复核）

本会话环境说明给出的检出路径 `D:\dsh\resources\app.asar\dsh\` **无法用文件系统 API 读取**：`app.asar` 是打包归档（117 MB），不是目录，`Test-Path` 返回 False 属预期。

实际可读的只有：

| 路径 | 内容 |
|---|---|
| `D:\dsh\resources\app.asar.unpacked\dsh` | **只有 `node_modules`**（未打包的原生依赖），没有应用源码 |
| `D:\dsh\resources\runtime` | `bin`、`primary-runtime`、`pnpm`、`office-skills`、`versions.json` |
| `D:\dsh\resources\app-update.yml` | 更新源与渠道（`channel: nightly`） |

**因此**：本文档中 DSH 接口的事实（`session/event` 的事件信封 `{type, seq, time, data}`、`ctx.credentials` 的 `readRecord`/`modifyRecord`/`deleteRecord`、cordis `Config` 必须是 schema、非注入服务属性必须走 `ctx.inject` 等）**不可能来自 grep 该路径**，而是来自**对运行中宿主的实测**——这也是更强的证据，因为它验证的是实际行为而非声明。

**对后续会话的影响**：不要假设 DSH 源码可直接检索；要么按本文档的方式在真实宿主中探测，要么先解包 `app.asar`（本会话未做，也未安装任何解包工具）。同理，**I1 剩余项（真实会话事件标识字段、desktop profile 激活）仍需在真实宿主中确认**，不可能靠读源码在不接触宿主的情况下完成。
