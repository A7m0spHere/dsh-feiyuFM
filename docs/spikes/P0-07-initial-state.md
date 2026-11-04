# P0：首次安装后的网易云状态初始化

日期：2026-11-04。先记录根因，后实现修复；不发布 npm，不合并 main。

## 已证实的故障与边界

本机日常 profile 的 `dsh-feiyufm` 来源实际为 `github:A7m0spHere/dsh-feiyuFM`，锁文件指向 `50c8442`，包版本为 0.1.0。客户端与正式 npm 包的 SHA-256 一致；后端关键文件忽略 CRLF 后内容一致，没有发现旧 `dsh-feiyufm-core` 重复注册。本机 DSH 当前未运行，没有重启或修改日常 profile。

从该安装目录启动 Core，使用只读 `VACUUM INTO` 得到的旧库副本和同用户加密凭据副本，启动即失败：`MODULE_NOT_FOUND: @neteasecloudmusicapienhanced/api`，调用位置为 `src/providers/netease.mjs:71`，退出码 1。旧库 schema 为 11；同一数据库副本通过仓库中完整依赖启动成功。因此已证实本机故障首先是安装目录缺少运行依赖，并非扫码接口或数据库迁移失败。

profile 的 pnpm 锁文件把两个直接依赖列为 `bundledDependencies`，GitHub 条目的 dependency snapshot 为 `{}`；GitHub 源码归档没有随 npm tarball 一起打包的 `node_modules`。`qrcode` 恰好可从 profile 的其他依赖解析，网易云依赖则无法解析。这解释了后端入口可加载、独立 Core 却启动失败。此证据不等于所有安装途径都失败。

公开 npm `dsh-feiyufm@0.1.0` tarball 已重新下载，SHA-256 为 `9c0e4f2bd8d95ee5956e001a13ac1259052e3186286c7c019cf029f32fc92e4c`，与发行封存一致。在全新官方 DSH 0.2.1-rc.5 Web profile 中使用默认真实 Core/Provider、空数据库安装：minimal RPC 返回 HTTP 200、snapshot/platforms/library 均成功，挂载的正式客户端出现可点击且可见的“扫码登录”。健康正式包本身未复现故障。

在另一全新 profile 中安装同一正式包，只将隔离安装内的网易云依赖移出解析路径：minimal RPC 返回 `core_unavailable`；真实挂载页面持续显示“读取中”，没有扫码按钮。由此复现了与本机缺依赖相同的失败链，且发生在二维码请求之前。

## 源码失败路径

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

待在本分支记录最小修复、修复前后回归、正式包保留旧库重装、修复包隔离安装及二维码生成结果。首次轻量引导为独立 P1。
