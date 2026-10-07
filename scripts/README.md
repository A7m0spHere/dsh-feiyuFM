# 维护脚本索引

从仓库根目录运行。常规入口由 `package.json` 管理；脚本名称不代表生产验收已经通过。

## 构建与离线检查

| 入口 | 作用 |
|---|---|
| `npm run check` | Node 版本、源码语法与客户端 bundle 一致性 |
| `npm run build:client` | 从 `src/ui/client/` 生成 DSH 单文件客户端 |
| `npm run build` | 生成客户端、检查、构建 `dist/` 并运行 debug smoke |
| `npm test` | 自动化回归；Windows 默认包含静音 WPF 媒体回归，需可用音频环境 |
| `npm run audit:acceptance` | 验收引用和文档链接核对，只检查证据存在，不替代运行验收 |
| `npm run verify:lifecycle` | 在隔离临时状态目录验证生命周期，不访问真实 DSH home |

托管 CI 通过 `FISHFM_TEST_REAL_AUDIO=0` 跳过三项真实媒体回归，协议和控制测试仍运行。不要把跳过、引用审计或构建当作生产通过。

## 预览、包与素材维护

| 入口 | 作用与输入 |
|---|---|
| `npm run preview:ui -- --react-root <已有 node_modules> --port 4179` | 模拟 UI，复用 React 18 UMD；不访问账号或播放歌曲 |
| `npm run verify:package` | npm dry-run 白名单核对，不发布、不生成安装后的生产验收 |
| `node scripts/verify-installed-package.mjs <consumer-directory>` | 在已安装的隔离消费者目录核对入口、资源、依赖及静音 WPF；消费者通常应在仓库外 |
| `node scripts/dependency-notices.mjs` | 根据锁定依赖生成许可清单；生成结果需审阅并提交 |
| `node scripts/import-doll-artwork.mjs --source <Workshop目录>` | 按 U12 来源 hash 提取原图；正常安装不需要再提取 |
| `python scripts/cutout-whale-pot.py --source <原附件>` | U10 指定附件的逐帧资产构建，不用于普通运行；工具依赖见 U10 |

素材声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)，素材文件只维护在 `src/ui/assets/`；原型和真实客户端共用这套资源路由。

## 音频、账号与观察

| 入口 | 实际边界 |
|---|---|
| `npm run smoke:playback` | 真实 WPF 合成测试音，无平台账号；会发声 |
| `npm run login` | 真实平台扫码，授权由用户完成，不属于常规离线整理 |
| `npm run observe:runtime -- --seconds <时长> --out <报告>` | 附着已运行生产插件的证据，不启动第二个 Core |
| `node scripts/observe-processes.mjs --seconds <时长> --out <报告>` | Windows 进程资源只读观察，不输出命令行/凭据 |
| `node scripts/audit-real-observation.mjs --report <报告> --database <库>` | 只读数据库核对既有真实观察，不实例化 Core |
| `npm run soak -- --fake --minutes 5` | 合成耐久演练；延长到 120 分钟仍不能代替 A09 的真实平台/DSH 对照 |

不要为了“整理仓库”执行登录、真实发声、生产观察或长跑。需要这些证据时按 [开发路线](../docs/PROJECT_PLAN.md) 的具体任务运行。

`make-tone.mjs`、`client-bundle.mjs` 和 `fixtures/` 是脚本复用模块/替身。早期 P0 探针放在根 [spikes/](../spikes/README.md)，当前流程以本索引和生产源码为准。
