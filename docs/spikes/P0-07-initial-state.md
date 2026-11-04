# P0：首次安装后的网易云状态初始化

日期：2026-11-04。先记录根因，后实现修复；不发布 npm，不合并 main。

## 已证实的故障与边界

本机日常 profile 的 `dsh-feiyufm` 来源实际为 `github:A7m0spHere/dsh-feiyuFM`，锁文件指向 `50c8442`，包版本为 0.1.0。客户端与正式 npm 包的 SHA-256 一致；后端关键文件忽略 CRLF 后内容一致，没有发现旧 `dsh-feiyufm-core` 重复注册。本机 DSH 当前未运行，没有重启或修改日常 profile。

从该安装目录启动 Core，使用只读 `VACUUM INTO` 得到的旧库副本和同用户加密凭据副本，启动即失败：`MODULE_NOT_FOUND: @neteasecloudmusicapienhanced/api`，调用位置为 `src/providers/netease.mjs:71`，退出码 1。旧库 schema 为 11；同一数据库副本通过仓库中完整依赖启动成功。因此已证实本机故障首先是安装目录缺少运行依赖，并非扫码接口或数据库迁移失败。

profile 的 pnpm 锁文件把两个直接依赖列为 `bundledDependencies`，GitHub 条目的 dependency snapshot 为 `{}`；GitHub 源码归档没有随 npm tarball 一起打包的 `node_modules`。`qrcode` 恰好可从 profile 的其他依赖解析，网易云依赖则无法解析。这解释了后端入口可加载、独立 Core 却启动失败。此证据不等于所有安装途径都失败。

公开 npm `dsh-feiyufm@0.1.0` tarball 已重新下载，SHA-256 为 `9c0e4f2bd8d95ee5956e001a13ac1259052e3186286c7c019cf029f32fc92e4c`，与发行封存一致。在全新官方 DSH 0.2.1-rc.5 Web profile 中使用默认真实 Core/Provider、空数据库安装：minimal RPC 返回 HTTP 200、snapshot/platforms/library 均成功，挂载的正式客户端出现可点击且可见的“扫码登录”。健康正式包本身未复现故障。

在另一全新 profile 中安装同一正式包，只将隔离安装内的网易云依赖移出解析路径：minimal RPC 返回 `core_unavailable`；真实挂载页面持续显示“读取中”，没有扫码按钮。由此复现了与本机缺依赖相同的失败链，且发生在二维码请求之前。

## 源码失败路径

日常 DSH 路径为 `index.js` 创建 `src/dsh-adapter.mjs` 的 `CoreBridge`，再由 `registerSettingsApi` 接收 controller 的认证 RPC。`src/ui/bridge.mjs` 是独立 UI transport，提供 `connect()`，不是本链路中调用 `start()` 的 Bridge。

1. 首个 controller 订阅触发 `refresh()`，发送 `{ minimal: true }` 的 `fishfm/state`。
2. `bridge.start()` 失败时，handler 返回 `ok:false`；controller 保存错误并保持 `snapshot:null`。
3. Panel 用 `!snapshot` 无条件显示“读取中”，没有区分首次等待与已失败；只有 `platforms.netease.installed` 为真才显示登录按钮。
4. 后端可启动时，`readSettingsState()` 的 snapshot/platforms/library 共用 `Promise.all()`，任何一项失败都会丢掉其余成功结果，包括非关键曲库读取。
5. controller 18 秒超时只发送 abort；若 RPC 实现没有兑现取消，`read` 永远不释放，之后轮询与手动刷新都直接返回。

修复前七项针对性回归全部失败，分别覆盖上述页面错误、两种部分失败、忽略 abort 的 RPC 和阶段诊断。正常路径已有回归。

## 复现与证据

脱敏摘要见 [结构化证据](assets/P0-07-initial-state.json)。完整 profile、日志、数据库与凭据只保留在本机临时隔离目录，不入库；诊断和报告不输出账号、Cookie、登录 key 或二维码链接。

```powershell
npm pack dsh-feiyufm@0.1.0 --ignore-scripts --pack-destination <临时目录>
node scripts/probes/initial-state-install.mjs --package <正式tgz> --out <全新目录>
node scripts/probes/initial-state-install.mjs --package <正式tgz> --out <另一全新目录> --missing-dependency
```

探针从 DSH CLI 安装，走认证 RPC 与实际安装的客户端；默认生产 Core，不注入合成平台，不请求模型或播放。`--database-from` 只读复制旧库，`--qr` 仅在按钮出现后申请二维码；真实扫码授权留给用户。

## 修复与验证

最小修复包括：源码 manifest 去掉错误的 bundle 声明，新增临时发行树打包入口，继续交付自带依赖与许可的 npm tgz；Core 用脱敏 `startup-error` 报告缺依赖，Bridge 保留具体错误码；状态读取对三个结果分别结算；controller 的 18 秒超时实际结束等待并释放读取锁；平台区域区分读取中／读取失败，提供重试，曲库失败保留登录入口。生成的客户端同步提交。推荐、播放导航、画像 schema 和真实账号授权规则均未改变。

针对性回归在修复前 **0/7**、修复后 **7/7**；另补 Core 结构化启动错误、脱敏与重启恢复回归，相关四个测试文件最终 **100/100**。完整构建、179 模块检查、debug smoke、发行包白名单及许可检查通过。

当前 `test/` 完整套件 **720 项、718 通过、2 失败、0 跳过**（133.35 秒）。失败为 `playback-warm` 的宿主自生成静音资源加载与 `playback-wpf` 的同源重开，均为 `media_open_timeout`；分别单独复跑仍在 12 秒／8 秒阈值超时，保留未通过。本轮未修改这两项测试及其 `src/playback/` 依赖。最初无路径的自动测试发现还扫描了已有 `work/baseline`，得到 1375 项及 4 个失败；该分母不代表当前套件，后续使用 `rg --files test -g '*.test.mjs'` 枚举当前文件。

| 隔离安装场景 | 观测 |
|---|---|
| 公开 npm 正式包、空库 | snapshot/platforms/library 成功，扫码按钮可见且可点击 |
| 同包缺网易云依赖（修复前） | `core_unavailable`，无 snapshot，平台区域仍“读取中”，无扫码按钮 |
| 正式包、旧库副本、CLI 卸载再安装 | 卸载／安装前后库文件 SHA-256 一致，233 首可读取，扫码按钮可见且可点击 |
| 不声明 bundle 的源码 tarball | DSH 正常解析并安装 dependencies，minimal RPC 成功，扫码按钮出现；这验证源码依赖安装语义，不冒充已合并的远端 GitHub 安装 |
| 本地修复包、空库 | minimal RPC 成功，扫码按钮出现，真实网易云二维码生成成功，状态 `waiting`；未扫码授权 |
| 本地修复包、缺依赖 | 明确显示 `dependency_missing`、“读取失败”及重试入口，无虚假登录按钮 |
| 本地修复包、恢复依赖 | 通过页面“重新连接”恢复 snapshot 和可用的扫码按钮，不重建数据库 |

探针发现并排除了验证干扰：诊断插件若置于本仓库内，宿主会同时发现仓库的 `dsh.client`，可能覆盖安装客户端。现将诊断插件复制到独立私有 package，核对安装的客户端 SHA-256，并检查实际挂载 controller 是否具有该版本的初始化诊断能力。中间一次受干扰的旧库页面结果不计入验收，已用独立探针重跑正式包旧库卸载重装，挂载版本核对通过。

界面复验先以宿主提供的“继续”／“关闭”处理新 profile 的预览说明和可选 DeepSeek 登录提示，不配置 DeepSeek 账号或 API Key。随后用鼠标事件进入电台设置，确认扫码按钮中心的 `elementFromPoint` 命中按钮，再实际点击申请网易云二维码；不把仅有 DOM 节点或被遮罩挡住的按钮计为可点击。此处只处理测试宿主已有提示，不实现插件 P1 引导。

最终采用五条实际交互记录：公开包空库和本地修复包均实际点击并生成真实二维码；公开包保留旧库卸载重装、普通源码包均有无遮挡的可用扫码按钮；修复包缺依赖时明确报错，恢复依赖后实际点击“重新连接”恢复入口。五条均核对实际安装客户端并正常关闭隔离宿主，摘要见结构化证据的 `verifiedRuns`。宿主首次工作区导航的延迟更新由探针在选择面板前等待完成，不改宿主代码。

清理限制：直接诊断时产生的两份临时加密凭据／引用文件，递归删除及缩小到逐文件删除均被自动审查拒绝，工具只返回 `blocked by policy`；未改用其他工具绕过。它们仍在本机系统临时目录的 `feiyufm-p0-20261104/retained-db/credentials/`，未入库、未上传，原始日常凭据未修改。其余隔离 profile／私有日志保留供复核，公开证据只记录安全字段。

全量回归、最终修复包摘要与严格隔离复核结果以结构化证据及 PROJECT_PLAN 的本轮行维护。真实扫码授权、登录后的真实账号校验和日常 Desktop 加载仍需用户参与；二维码生成不等于授权完成。首次轻量引导为独立 P1，本轮不实施；不发布 npm，不合并 main。
