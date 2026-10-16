# REV-04 宿主故障隔离审计（#6）

对应上游 issue [#6](https://github.com/A7m0spHere/dsh-feiyuFM/issues/6)，参考项目 [dsh-bili-scroll #1](https://github.com/c1overzz/dsh-bili-scroll/issues/1)。
审计基线：`930c454`（2026-10-16）。环境：Windows / Node 24.14.0。本轮**只做代码级故障注入与离线回归**；用户已取消两小时连续运行观察（见 PROJECT_PLAN），不用它替代现场结论。

## 结论摘要

| 风险入口 | 当前保护 | 判定 |
|---|---|---|
| `src/runtime/evidence.mjs` 的 `flush()`（唯一未加记录的日志终点） | 仅 `catch {}`，无任何失败计数 | **确认缺陷（已修复）** |
| `dsh-adapter.mjs:_log()` | `try { onLog } catch {}` | 已覆盖 |
| `runtime/host-collector.mjs:emit()` | `try { onLog } catch {}` | 已覆盖 |
| `persona-model.mjs` `music-model-*` 日志 | 逐个 `try/catch` | 已覆盖 |
| `persona-scheduler.mjs:emit()` | `try/catch` | 已覆盖 |
| `playback/supervisor.mjs:298` 子进程 stdout/stderr 逐行日志 | `try { onLog } catch {}` | 已覆盖 |
| `index.js:110/167` 证据生命周期 | `ctx.effect` + `evidence.close()` | 已覆盖 |

未发现 FishFM 存在参考项目那种「未捕获异常带走 DSH 宿主」的直接形态：所有 `onLog` 转发点均已包一层。**真正的缺口不是崩溃，而是证据静默失真。**

## 确认缺陷：日志写不下去时没有任何人知道

### 代码位置与原因

`src/runtime/evidence.mjs` 的 `flush()`（`sample()` 每 5 秒调用一次）整段被 `catch { /* Diagnostics must not interrupt music. */ }` 吞掉，且报告里没有任何字段记录「这次写没写进去」：

- 目录被占用（EBUSY/EPERM）、权限变化（EACCES）、磁盘满（ENOSPC）、路径被目录占用时，**证据文件静默停止更新**。
- 所有证据消费者（`script/observe-runtime`、`audit:acceptance`、A08/A09 判定）都经过 `readRuntimeEvidence`，它只有 `stale = closed || now - updatedAt > 20_000`。
- 于是一份**写不进去的证据文件与一个卡死的进程，在判定上完全无法区分**。
- `close()` 原先还会无条件写 `closed: true`，把一个没落盘的运行标成「干净收尾」。

### 观测（故障注入）

以「flush 目标被同名目录占用」注入（真实 Windows 上表现为 `EPERM`，与 EBUSY/EACCES 同类）：

```text
BEFORE            {"runIdPresent":true,"updatedAt":1000000,"closed":false,"events":1}
SELF（模块自认）   {"events":6,"counts":{...5 类事件全在...},"writeHealth":{"attempts":3,"failures":1,"lastError":"EPERM","lastSuccessAt":1000000}}
AFTER（读盘）      coreFileOnDisk: null
HEALTH-WHILE-BROKEN {"attempts":3,"failures":1,"skipped":0,"lastError":"EPERM"}
```

即：**进程内存里一切正常、事件计数完整，磁盘上什么都没有，而读者只会看到「文件不存在」或「过期」**。

另有一条独立入口：运行被新的 Core 取代后，旧实例的 flush 会被 `runId` 校验**静默拒绝**（`return`），同样不留痕迹：

```text
SUPERSEDE-ATTEMPT {"refused":true,"refusedEvents":["p4"],"staleThinksItWrote":2,"writeHealth":{"skipped":1}}
SUPERSEDED        {"onDiskRunId":<fresh>,"freshRunKeptItsFile":true}
```

### 同步写盘的主线程成本（同类风险，未改设计）

`flush()` 是同步 `mkdirSync/writeFileSync/renameSync` + 全量 `JSON.stringify(report())` + `structuredClone(events)`，每 5 秒在宿主事件循环上跑一次。实测单次耗时随事件数增长：

| 事件数 | 文件大小 | 单次 flush |
|---|---|---|
| 24 | 3.1 KB | 5.9–6.9 ms |
| 300 | 32.6 KB | 6.9–8.1 ms |
| 900 | 97.2 KB | 8.5–9.5 ms |
| 2000（上限） | 217 KB | 15.6–16.8 ms |

真实事件混合（7/10 为被限流的 progress，其余为 command/platform-request/started）下，喂入 4000 条后驻留事件约 1312 条、文件 120 KB，单次 flush 稳定在 **4.9 → 7.8 ms**，增长平缓：

```text
fed 500  kept 164  15.6 KB  4.9 ms
fed 2000 kept 656  60.3 KB  6.1 ms
fed 4000 kept 1312 120.2 KB 7.8 ms
```

结论：会阻塞宿主数毫秒量级，但**不构成必须重构的缺陷**（progress 被 5 秒限流，事件上限 2000 有界）。本轮不改为异步写，避免为审计而重构；如日后要长时运行再评估。

### 修复

`src/runtime/evidence.mjs`：

- 新增 `writeHealth`（`attempts / failures / skipped / lastError / lastFailureAt / lastSuccessAt`），写入报告本身，落盘失败被**计数并带上错误码**，业务行为不变（仍然绝不抛错）。
- `runId` 不符时的静默拒绝改为显式 `skipped++`，与被占用的失败区分开。
- `close()` 只在最后一次写真正落盘时才置 `closed: true`；未落盘或**被跳过**时保持 `false`，读者不会把上一份好报告当成本次运行的终态。
- 失败时**不写「健康」字样**，也不改变音乐行为：仍然丢弃诊断、不宣称任何业务成功。

### 复核发现的第二个缺口（同一轮内补齐）

首版修复有一个残留：**`writeHealth` 只能随「某次成功的写」落盘**。于是当写入**永久**失败时，报告本身写不出去，读者拿到的只是「文件不存在」——**失败记录恰恰在最需要它的场景下不可达**。实测：

```text
IN-MEMORY-KNOWS  {"attempts":7,"failures":5,"lastError":"EPERM"}
READER-GETS      null
```

补齐三点：

1. **失败侧车** `<component>.write-failure.json`：写失败时尽力写一份；写入恢复后删除，**进程启动时也清掉属于别的 `runId` 的残留**（崩溃退出不会走 `close()`，否则陈旧告警会永远挂着说谎）。`readRuntimeEvidence` 以 `writeFailures` 单独返回，**不并入 `stale`**——「没启动」与「启动了但写不下去」因此可区分。
2. **`onWriteFailure` 回调**：活进程不必等到下一次成功写才知道出事；按**错误码去重**，同因只报一次，恢复后重新武装。
3. **错误码形状校验**：`lastError` 与事件文本字段用同一条 `^[\w:.-]{1,100}# REV-04 宿主故障隔离审计（#6）

对应上游 issue [#6](https://github.com/A7m0spHere/dsh-feiyuFM/issues/6)，参考项目 [dsh-bili-scroll #1](https://github.com/c1overzz/dsh-bili-scroll/issues/1)。
审计基线：`930c454`（2026-10-16）。环境：Windows / Node 24.14.0。本轮**只做代码级故障注入与离线回归**；用户已取消两小时连续运行观察（见 PROJECT_PLAN），不用它替代现场结论。

## 结论摘要

| 风险入口 | 当前保护 | 判定 |
|---|---|---|
| `src/runtime/evidence.mjs` 的 `flush()`（唯一未加记录的日志终点） | 仅 `catch {}`，无任何失败计数 | **确认缺陷（已修复）** |
| `dsh-adapter.mjs:_log()` | `try { onLog } catch {}` | 已覆盖 |
| `runtime/host-collector.mjs:emit()` | `try { onLog } catch {}` | 已覆盖 |
| `persona-model.mjs` `music-model-*` 日志 | 逐个 `try/catch` | 已覆盖 |
| `persona-scheduler.mjs:emit()` | `try/catch` | 已覆盖 |
| `playback/supervisor.mjs:298` 子进程 stdout/stderr 逐行日志 | `try { onLog } catch {}` | 已覆盖 |
| `index.js:110/167` 证据生命周期 | `ctx.effect` + `evidence.close()` | 已覆盖 |

未发现 FishFM 存在参考项目那种「未捕获异常带走 DSH 宿主」的直接形态：所有 `onLog` 转发点均已包一层。**真正的缺口不是崩溃，而是证据静默失真。**

## 确认缺陷：日志写不下去时没有任何人知道

### 代码位置与原因

`src/runtime/evidence.mjs` 的 `flush()`（`sample()` 每 5 秒调用一次）整段被 `catch { /* Diagnostics must not interrupt music. */ }` 吞掉，且报告里没有任何字段记录「这次写没写进去」：

- 目录被占用（EBUSY/EPERM）、权限变化（EACCES）、磁盘满（ENOSPC）、路径被目录占用时，**证据文件静默停止更新**。
- 所有证据消费者（`script/observe-runtime`、`audit:acceptance`、A08/A09 判定）都经过 `readRuntimeEvidence`，它只有 `stale = closed || now - updatedAt > 20_000`。
- 于是一份**写不进去的证据文件与一个卡死的进程，在判定上完全无法区分**。
- `close()` 原先还会无条件写 `closed: true`，把一个没落盘的运行标成「干净收尾」。

### 观测（故障注入）

以「flush 目标被同名目录占用」注入（真实 Windows 上表现为 `EPERM`，与 EBUSY/EACCES 同类）：

```text
BEFORE            {"runIdPresent":true,"updatedAt":1000000,"closed":false,"events":1}
SELF（模块自认）   {"events":6,"counts":{...5 类事件全在...},"writeHealth":{"attempts":3,"failures":1,"lastError":"EPERM","lastSuccessAt":1000000}}
AFTER（读盘）      coreFileOnDisk: null
HEALTH-WHILE-BROKEN {"attempts":3,"failures":1,"skipped":0,"lastError":"EPERM"}
```

即：**进程内存里一切正常、事件计数完整，磁盘上什么都没有，而读者只会看到「文件不存在」或「过期」**。

另有一条独立入口：运行被新的 Core 取代后，旧实例的 flush 会被 `runId` 校验**静默拒绝**（`return`），同样不留痕迹：

```text
SUPERSEDE-ATTEMPT {"refused":true,"refusedEvents":["p4"],"staleThinksItWrote":2,"writeHealth":{"skipped":1}}
SUPERSEDED        {"onDiskRunId":<fresh>,"freshRunKeptItsFile":true}
```

### 同步写盘的主线程成本（同类风险，未改设计）

`flush()` 是同步 `mkdirSync/writeFileSync/renameSync` + 全量 `JSON.stringify(report())` + `structuredClone(events)`，每 5 秒在宿主事件循环上跑一次。实测单次耗时随事件数增长：

| 事件数 | 文件大小 | 单次 flush |
|---|---|---|
| 24 | 3.1 KB | 5.9–6.9 ms |
| 300 | 32.6 KB | 6.9–8.1 ms |
| 900 | 97.2 KB | 8.5–9.5 ms |
| 2000（上限） | 217 KB | 15.6–16.8 ms |

真实事件混合（7/10 为被限流的 progress，其余为 command/platform-request/started）下，喂入 4000 条后驻留事件约 1312 条、文件 120 KB，单次 flush 稳定在 **4.9 → 7.8 ms**，增长平缓：

```text
fed 500  kept 164  15.6 KB  4.9 ms
fed 2000 kept 656  60.3 KB  6.1 ms
fed 4000 kept 1312 120.2 KB 7.8 ms
```

结论：会阻塞宿主数毫秒量级，但**不构成必须重构的缺陷**（progress 被 5 秒限流，事件上限 2000 有界）。本轮不改为异步写，避免为审计而重构；如日后要长时运行再评估。

 规则，异常消息不会渗进证据文件。

健康路径的额外成本被显式控制：侧车删除只在**确实写过侧车**时才执行，避免每次 5 秒 flush 多付一次系统调用。

### 第三个缺口：消费者不读这份记录（同一轮内补齐）

修好「写得出来」不等于「有人看」。原先只有 `readRuntimeEvidence` 返回新字段，而**没有任何消费者使用它**，等于换了个地方沉默：

| 消费者 | 补齐后的行为 |
|---|---|
| `src/runtime/observation.mjs` | 累积 `evidenceWriteFailures` 与 `lastWriteFailure`；**有写失败时 `uninterruptedEvidence` 直接为 `false`**——一个连自身诊断都写不下去的窗口，计数器再好看也不是干净证据 |
| `scripts/observe-runtime.mjs` | 前置检查失败时区分「没在跑」与「跑了但写不下去」，并回报 `evidenceWriteFailures` |
| `scripts/observe-processes.mjs` | 同样按失败码给出真实原因，不再一律说「没有新鲜的生产运行时」 |
| `index.js` / `bin/fishfm-core.mjs` | 接入 `onWriteFailure`，活进程不必等到下一次成功写才知道出事；只输出类型与错误码，不含路径与凭据 |

### 复核确认无问题的一项

`OWNERSHIP` 用例显示新实例的构造期 flush 会接管文件（`ownerKeptFile:false`）。这是**既有语义「最新运行获胜」**，与既有回归「旧 Core 的迟到关闭不覆盖新运行」一致，不是缺陷。残留的窄边界：若 A 的首次写失败（`published` 仍为 `false`）而 B 已接管，A 之后首次成功会覆盖 B。**本轮不改**，已记入未覆盖项。

### 测试

`test/runtime-evidence.test.mjs` 新增 9 项、`test/observation.test.mjs` 新增 2 项（故障注入，全部离线确定性）：

1. 写失败被计数且带错误码，报告里可读；健康路径不误报失败。
2. 被其他运行占有时记为 `skipped`，且不与 fs 失败混同；新运行的报告不被旧实例覆盖。
3. 最后一次写没落盘时 `closed` 保持 `false`，读者拿不到伪造的干净收尾。
4. **永久失败**下侧车仍让读者拿到原因（报告为 `null` 但 `writeFailures` 有据）。
5. 恢复后侧车被清除，但失败历史不被抹掉。
6. 活进程通过回调即时得知，同因只报一次，恢复后重新武装。
7. 首次写就失败时 `close()` 也不谎称干净收尾。
8. 记录的 `lastError` 只能是错误码形状，不含消息与空格。
9. 观测窗口看到写失败时不再声称 `uninterruptedEvidence`；健康窗口显式回报 0 而非缺字段。
10. 崩溃退出的运行留下的告警不会粘到后续健康运行上。

审计探针从 `test/probe/` 迁到 [scripts/probes/](../../scripts/probes/)：`test/` 下的一切都会被 `node --test` 当测试执行，原先会让探针混进套件、虚增测试数。

## 未覆盖 / 未验证（如实记录）

- 未在真实 DSH 宿主里注入 EBUSY（例如用真实占用文件的进程）；本轮用等价的可控故障注入。
- 窄边界未修：A 的首次写失败（`published` 仍 false）而 B 已接管时，A 之后首次成功会覆盖 B。
- macOS 的 Keychain helper、真实多窗口、真实并发拒绝路径未新增现场验证。
- 「暂停/静音/禁播/凭据清理契约不退化」沿用既有 456→461 项回归与 REV-01–03 记录，本轮未重跑真机。
- 两小时连续运行已由用户取消，不再作为本审计的验收手段。

## 参考

- [上游 issue #6](https://github.com/A7m0spHere/dsh-feiyuFM/issues/6) · [dsh-bili-scroll #1](https://github.com/c1overzz/dsh-bili-scroll/issues/1)
- [架构](../ARCHITECTURE.md) · [PROJECT_PLAN](../PROJECT_PLAN.md)
