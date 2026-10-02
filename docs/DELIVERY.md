# 交付说明（R4）

2026-10-02：网易云 [P3 首条真实闭环](spikes/P3-real-loop.md) 通过，已有会话恢复、近期导入 100 首、点播/暂停/恢复/下一首、离开面板续播、停用清理与重新启用暂停恢复已实测，用户确认声音正常。243 项离线测试、69 模块检查与构建通过。本机结束状态：插件启用、音乐暂停、账号和曲库保留；QQ 与两小时验收未完成，未发布 v0.1。以下较早日期的状态为历史记录。

- 版本：**0.1.0-dev**（未发布，未打 tag）
- 日期：2026-09-29

2026-10-01：网易云真实扫码、DPAPI 和账号 ID 复核已通过，见 [U6](spikes/U6-qr-login-repair.md)；用户重载后新 Core 已启动。最终桌面运行时 240/240 测试、69 模块检查及构建通过。平台导入/音频仍待验；宿主 RPC 等待上限改动在下次正常重启应用时生效，不强制结束当前 DSH 任务。

2026-09-30 增量：已适配并安装到本机官方桌面版 `0.2.0-rc.2`，验证主面板/设置窗口、持久化/停用恢复及悬浮条基础交互；当前 227 项离线测试通过。平台歌曲未导入/播放，仍是开发预览。范围和后端缓存重启要求见 [U5](spikes/U5-official-desktop.md)。下方 2026-09-29 PHL/命令结果为历史记录。
- 状态：**开发预览，不是 v0.1 发布**。离线核心与新 UI 部分完成；PHL“2”账号会话已被真实 `login_status` 判为过期，尚无曲目导入或平台音频播放。MVP 的 10 条验收中 **0 条完全通过**（逐条见[完成度总表](PROJECT_PLAN.md#完成度总表)）。

2026-09-29 UI 与 Provider 增量：主侧栏“肥鱼电台”和设置页连接独立 Core；DSH `shell.overlay` 新增同 Core 的音乐状态条、快捷抽屉和三点菜单。网易云账号/音乐读取使用固定 `@neteasecloudmusicapienhanced/api@4.40.1`，保留 QR 和 DPAPI 流程。PHL“2”旧会话的真实 `login_status` 响应为游客态，Core 已将引用改为 expired；没有歌曲请求或导入。QQ 无经过核实的 endpoint map，面板不会展示登录按钮。页面视觉验收因 PHL 实例 Web server 未运行而未完成。边界见 [U3](spikes/U3-dsh-settings.md)、[U4](spikes/U4-quick-login.md) 和 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 1. 支持范围

| 项目 | 范围 |
|---|---|
| 操作系统 | **仅 Windows**（首轮验证环境）。播放服务依赖 WPF/`MediaPlayer` 与命名管道；其他系统**未承诺兼容**，也未测试 |
| Node | **24.14～24.x**（`package.json` 的 `engines` 约束）。使用内置 `node:sqlite`，会打印 experimental 警告 |
| DSH | 工具/命令和停用清理在 **0.1.7-rc.2** 真实宿主验证；`0.2.0-rc.1` PHL 管理的 Web profile 已安装 bundle 并启动 Core，工具实际调用及卸载未验；**desktop profile 的安装需经应用内插件界面** |
| 音乐平台 | 网易云的二维码 key、等待和过期 endpoint 有真实服务探测证据；账号扫码确认、cookie 回存、导入与真实播放尚未验收。QQ 适配器离线存在，但 endpoint profile 不可用 |
| DSH UI | **部分交付**：侧栏/设置页和 `shell.overlay` 悬浮条代码已完成，并用同一 Core 控制；PHL“2”新 UI 的实例视觉验收未完成。没有独立桌面窗或托盘 |

## 2. 安装与构建

```sh
git clone https://github.com/A7m0spHere/dsh-feiyuFM.git
cd dsh-feiyuFM
npm ci --ignore-scripts --no-audit --no-fund
```

**本轮已验证**：在空 `node_modules` 上执行上述 `npm ci`，从 `package-lock.json` 安装 **287 个包**；`npm ls --all --parseable` 共 288 条路径（含项目根节点）。依赖规模增加主要来自固定的网易云社区 API 包。

要求：Node 24.14～24.x、Windows。**无需**音乐账号即可完成全部离线检查。

### 已实测通过的仓库命令

| 命令 | 结果（2026-09-29 实测） |
|---|---|
| `npm run check` | `Checked 68 modules on Node 24.14.0` |
| `npm test` | **225/225 通过** |
| `npm run build` | `Built dist/ and ran debug smoke` |
| `npm run debug` | 按 README 的 JSON 行示例输入，输出预期快照；退出码 0 |
| `npm run soak -- --minutes 5 --fake` | 请求计数与资源采样，见 [R2 证据](spikes/R2-soak.md) |
| `npm run verify:lifecycle` | **14/14**：干净起步无库、按文档路径建库、schema v3、导入后重启保留数据与人格种子、停用退出码 0、登出清凭据与引用、可重新登录、删库清数据 |
| `npm run audit:acceptance` | **10/10** 验收项的引用文件与测试都存在；**0 处失效文档链接**；退出码 0 |
| `npm run login -- --dry-run` | 离线流程通过；PHL“2”现存 DPAPI 会话的真实 `login_status` 返回游客态，实际 UID/音乐导入待重新扫码 |

`npm run smoke:playback` **会真实出声**（播放 440 Hz 测试音）；本次交付核对期间**未运行**，因为用户尚未确认音频输出设备。

## 3. 构建产物

- `npm run build` 产出 `dist/`（开发用构建，非发布包）。
- 插件形态是**仓库内的 bundle**：`package.json` 的 `dsh.bundle.patch` → [`cordis.patch.yml`](../cordis.patch.yml) → [`index.js`](../index.js)。安装到真实 profile 需经应用内插件界面（见 [P0-01](spikes/P0-01-dsh.md)）。
- **未发布 npm 包，未打 tag，未产出安装器。**

## 4. 数据与凭据

| 项目 | 位置与处理 |
|---|---|
| SQLite | `$DSH_HOME/fishfm/music.sqlite`（插件路径）；调试入口可用 `--db <路径>` 指定 |
| 平台会话 | **DPAPI CurrentUser 加密**后的密文文件（`<目录>/credentials/<ref>.dpapi`）；**SQLite 只存引用**，命令**从不打印会话内容** |
| 数据库内容 | 环境、偏好、历史、约束、迁移版本。**不保存长期有效的音频 URL** |
| 清理 | 删除数据库文件即可清除本地数据；`logout()` 会同时删除凭据与其引用 |

`node:sqlite` 在 Node 24 上会打印 `ExperimentalWarning`——这是运行时行为，不是错误。

## 5. 已知限制（不粉饰）

按"未验证"与"未实现"分开列出。

### 未验证（已实现但从没在真实环境跑过）

1. **有效会话下的真实音乐平台链路**：已用 PHL“2”现存凭据请求一次 `login_status`，服务返回游客态，确认旧会话失效；近期/喜欢/歌单、搜索、资源解析和导入尚未用有效账号验收，需要用户重新扫码。
2. **真实平台音频播放**：`resolve` 拿到的地址未真正播放过；会员/版权限制、地址过期后的重取未验。
3. **真实多 Session 并发**：判定逻辑有测试，真实 DSH 会话对象的**标识字段名**未确认（代码会记录该对象键名以便下次确认）。
4. **两小时运行与 DSH 侧请求对照**（A09）：测量工具与加速跑就绪，真实两小时未跑。
5. **新 DSH 悬浮条现场交互**：当前 PHL Web server 未运行，拖动、边缘吸附、主题/窄屏布局和实际截图未验。
6. **desktop profile 的插件安装**：本机 rc.2 已经 Plugin Manager 实测，见 [U5](spikes/U5-official-desktop.md)；其他设备/版本未验。
7. 真实断网、真实睡眠/恢复、进程句柄与内存曲线。

### 未实现

1. **独立桌面窗口/托盘**：不属于当前产品形态；控制 UI 使用 DSH 页面内 `shell.overlay`。
2. **多 Session 的活动 Session 优先级对播放的影响**：判定已实现，但真实的"哪个会话更活跃"未与播放策略联动验证。
3. **网易云社区 API 的真实账号歌曲来源**：本地调用集成已走固定 Node API 的 WeAPI 实现，但尚未通过有效会话请求验证。
4. **QQ 的端点映射**：连假设都还没有可靠依据，`npm run login --provider qq` 会明确拒绝。
5. 上一首（**刻意不交付**，见 MVP）、歌单管理与评价界面。

### 参数均为首版取值

人格、选歌、成长、多 Session 的全部数值（`0.5`/`±0.15`/`×0.45`/`30 分钟`/`0.03`/`2%/天`/`0.5 权重`/`8 次上限` 等）**没有真实听歌数据支撑**，理由与取值记在 [DECISIONS](DECISIONS.md) 第 11–14 节，待真实数据调整。

## 6. 代码与素材归属

| 项目 | 说明 |
|---|---|
| 项目代码 | 本仓库自行实现；面板扫码图像由 Core 服务端本地产生，不调用第三方二维码生成服务 |
| `@neteasecloudmusicapienhanced/api@4.40.1` | **MIT**，通过 `login_status`、近期、喜欢、歌单和歌曲详情模块处理网易云会话与请求；由 `package-lock.json` 固定。它带来 258 个新增安装包，完整依赖树约 288 个包路径；不启动其中的 Express 服务 |
| `qrcode@1.5.4` | **MIT**，来源 <http://github.com/soldair/node-qrcode>，用于 `scripts/login.mjs` 和面板内存中的二维码 PNG |
| UI 状态图 | 项目此前生成的三张鲸鱼娘图片（见 [`prototypes/ASSETS.md`](../prototypes/ASSETS.md)）；未复制社区鲸鱼挂件素材 |
| 音频素材 | 仓库内**无音频文件**；测试用 WAV 由 `scripts/make-tone.mjs` 现场生成 |
| 参考项目 | `dsh-api-dashboard` 的 SwipeHandle 适配代码按 MIT 保留声明；余额鲸鱼挂件只参考布局，未复制代码或素材，见 [第三方声明](../THIRD_PARTY_NOTICES.md) |

## 7. 文档与实际的一致性

R4 要求"仓库文档与实际命令一致"。本次核对方式与结论：

- **逐条执行** README 中列出的每个命令，结果记在第 2 节表格里；
- 修正了 README 的状态描述（原为"Phase 1 离线控制核心已可运行，尚无接入真实 DSH 或音乐平台的插件"，与当前实现不符）；
- README 现在把命令分成"离线可跑"、"需要账号或会出声"、"尚未接线"三类，并标注后者会做什么；
- [完成度总表](PROJECT_PLAN.md#完成度总表) 与验收状态逐条标注，未把离线实现写成可用。

## 8. 未完成 R3/R4 的部分

- **干净 Windows 环境的安装验证**：`npm run verify:lifecycle` 覆盖了生命周期本身（干净起步、建库、保留、停用、登出、清数据，14/14），但它是在**开发机**上跑的隔离目录，**不是**一台干净系统。真机安装未做。
- **第二台设备按文档构建**：未做。
- **v0.1 交付的前提**（R2/R3 完成、A01–A10 全部有结果）**不满足**，因此本文是**开发预览的交付说明**，不是 v0.1 发布说明。

### 验证脚本能做什么、不能做什么

`npm run verify:lifecycle` 是可复现的那一半：它在隔离目录里跑完整个生命周期并逐项报告，任何机器都能跑。它**不能**替代干净系统安装、第二台设备构建，或把插件装进真实 DSH profile——脚本自己在结尾也会印出这句话。失败时加 `--keep` 保留现场与 JSON 报告。

`npm run audit:acceptance` 检查**每条验收声明的证据是否还在**：每个 A01–A10 都映射到具体文件与具名测试，脚本确认它们存在（`--json` 输出机器可读结果）。它检查的是**存在性与命名，不是正确性**——测试名通过不代表行为正确，所以每行同时印出"仍未验证"的部分。

这一点很重要，所以脚本本身做过**反向自测**：把一个被引用的测试改名后，审计**失败并指出确切的缺失测试**（9/10、退出码 1），恢复后重新通过（10/10、退出码 0）。没有这一步，"审计通过"可能只是空转。

它也顺带校验文档链接：**0 处失效**。曾误报过一个 `chatgpt-conversation://` 自定义协议链接——那是 DECISIONS 里的来源引用，不是相对路径，链接检查已按 URI 方案规则排除。
