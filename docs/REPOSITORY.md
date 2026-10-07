# 仓库结构与维护入口

先读 [AGENTS.md](../AGENTS.md) 了解协作规则，再读 [开发路线](PROJECT_PLAN.md) 确认当前源码、已发布包和生产状态。本文只维护文件位置和操作入口，不另复制任务状态或产品规格。

## 目录分工

| 位置 | 用途与维护方式 |
|---|---|
| [index.js](../index.js)、[cordis.patch.yml](../cordis.patch.yml)、[package.json](../package.json) | DSH 插件注册、bundle 配置和 npm 清单 |
| `src/core*.mjs`、`src/storage.mjs` | 播放控制、宿主协调与持久化；职责见架构 |
| `src/providers/`、`src/discovery.mjs`、`src/persona*.mjs` | 平台导入/候选、缓存、模型筛选和预算；现行流程见 MVP/契约 |
| `src/playback/`、`src/runtime/` | 独立音频服务与运行证据采集 |
| `src/ui/client/` | 主面板、设置页、悬浮条的可编辑源码 |
| `src/ui/assets/` | 运行图片的唯一文件位置；来源、hash 与许可见第三方声明及 U12 记录 |
| [bin/](../bin/fishfm-core.mjs) | Core 子进程与调试命令入口 |
| [test/](../test/recommendation-pipeline.test.mjs) | 自动化回归；不保存账号、数据库或音频 |
| [scripts/](../scripts/README.md) | 构建、发布核对、隔离预览、观察和素材维护；按脚本索引选择 |
| [prototypes/](../prototypes/README.md) | 用实际客户端渲染的模拟预览，不是另一套生产实现 |
| [spikes/](../spikes/README.md) | 早期可执行探针，保留原路径供历史复现，不作为当前安装或验证入口 |
| [docs/](README.md) | 当前规格、计划、设计、证据、发行与历史归档的导航 |
| [assets/readme/](../assets/readme/README.md) | 仓库首页 SVG 和指定日期的模拟截图，不能当当前生产截图 |
| `.github/` | CI 与问题模板；运行检查见 `workflows/core.yml` |

根目录 `spikes/` 存脚本，`docs/spikes/` 存报告与证据；两者按用途区分，不互相充当生产入口。

## 生成物与本机数据

| 位置 | 处理方式 |
|---|---|
| `src/ui/dsh-client.js` | 生成但受 Git 管理；编辑 client 源码后重新生成，不直接改 bundle |
| `dist/` | `npm run build` 可重建的开发产物，忽略提交，不是独立安装器 |
| `node_modules/` | 由 `npm ci` 恢复的依赖，忽略提交 |
| `.tmp/` | 本机实验、历史安装包、实例副本或图片工作区，忽略提交；按具体任务核对内容后清理，不整目录盲删 |
| `.mimosa/` | 本机工具状态，忽略提交 |
| `$DSH_HOME/fishfm/` | 用户数据库、DPAPI 凭据与运行证据，位于安装目录之外，不纳入仓库整理 |

历史交接文字在 [archive](archive/README.md)；它们按记录日期阅读，当前规则只有根 AGENTS.md 和各现行文档入口。

## 常规维护

```sh
npm run check
npm run build
npm run audit:acceptance
```

涉及运行行为再执行相称测试；发布范围改动再跑 `npm run verify:package`。音频、账号操作与真实观察脚本的要求见 [脚本索引](../scripts/README.md) 和 [贡献指南](../CONTRIBUTING.md)，不要因整理目录而操作生产账户或重跑验收。

npm 通过 `package.json` 的 `files` 白名单打包运行文件；测试、维护脚本、原型、早期探针、归档和本机临时资料不进入包。安装必须走 DSH Plugin Manager/CLI，`npm install` 与 `dist/` 都不是完整插件安装流程。

## 2026-10-07 整理记录

旧交接事实按原文归档并核对一致，路线文档移除重复的 N20“当前基线”并补 N21/N22，保留历史验收日期。三个原型 PNG 副本与正式素材 SHA-256 一致，清除副本后只维护 `src/ui/assets/`，工作区减少 4,257,164 字节；来源与许可说明保留。

链接审计覆盖根维护文档、docs、scripts、prototypes、spikes 和首页素材说明，跳过依赖、生成物及本机数据；新增入口的故意坏链接已实测触发失败并恢复，CI 同步加入审计。本轮 81 份文档零坏链接、127 模块检查、构建/debug smoke 与包白名单核对通过；dry-run 包仍为 4870 文件、约 34.84 MB，没有发布。

U14 的永久截图与 JSON 证据核对一致后，清掉 21 个旧模拟预览临时文件；其他本机 profile、安装包和工作资料保留。N22 的全量/浏览器结果仍为此前基线，本轮不改变播放/推荐行为，未重跑账号、音频或生产验收。
