# 参与肥鱼电台

欢迎使用简体中文反馈问题、讨论功能或提交改进。产品行为以 [MVP](docs/MVP.md) 为准，实际验收进度见 [PROJECT_PLAN](docs/PROJECT_PLAN.md)；开发前请阅读根目录 [AGENTS.md](AGENTS.md)。

## 反馈问题

请在 [Issues](https://github.com/A7m0spHere/dsh-feiyuFM/issues) 提供 Windows、Node.js、DSH 版本、插件提交号，以及复现步骤、预期结果和实际结果。播放问题请说明当时的自主听歌、声音、暂停状态和是否已登录。

截图与日志请先移除 Cookie、二维码、登录链接、凭据、账号信息和私人数据。问题模板不要求上传运行数据库。功能提议请描述使用场景与期望行为。

## 本地开发

使用 Windows 和 Node.js `>=24.14.0 <25`：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build
```

以上检查不需要音乐账号，也不会播放真实音频。`npm run smoke:playback` 会播放测试音；`npm run login` 会发起真实扫码登录，不属于常规离线检查。

`npm test` 在本机 Windows 默认包含 3 项静音 WPF 媒体打开/预热回归，需要可用的音频环境。托管 CI 无法打开这些 WAV，设置 `FISHFM_TEST_REAL_AUDIO=0` 只跳过这 3 项；管道、取消控制和 fake-backend 测试仍运行。真实音频应在 Windows 工作站执行并单独记录，本机测试通过不能替代 runner 的硬件验证，反之亦然。

### 目录入口

| 目录 / 文件 | 职责 |
| --- | --- |
| `index.js` / `cordis.patch.yml` | DSH 插件与 bundle 注册 |
| `src/core*.mjs` | 状态、队列、命令与宿主服务 |
| `src/providers/` | 平台账号、来源读取与资源解析 |
| `src/playback/` | 独立播放服务与 WPF 后端 |
| `src/ui/client/` | 主面板、设置页与悬浮条源码 |
| `test/` | 自动化测试 |
| `docs/spikes/` | 实验与验收证据 |

`src/ui/dsh-client.js` 是生成文件，请修改 `src/ui/client/` 后执行 `npm run build:client`，并提交同步后的 bundle。

### 隔离 UI 预览

复用已有的 React 18 UMD，不需要连接真实 DSH 或音乐账号：

```sh
npm run preview:ui -- --react-root "C:/path/to/existing/node_modules" --port 4179
```

`--react-root` 目录下需有 `react/umd/react.development.js` 和 `react-dom/umd/react-dom.development.js`。打开输出的本地地址即可查看主题、布局和模拟交互。预览中的统计和模型结果是固定示例，不能当作生产证据。

## 提交改动

维护者日常直接在 `main` 开发，每项任务独立提交；跨设备串行接续，工作区干净时先 `git pull --ff-only`，完成后推送再交接。外部贡献者可从 fork 的功能分支提交 PR。

提交标题保留 `feat:`、`fix:`、`docs:` 等英文类型前缀，后面的标题与说明使用简体中文，代码和技术标识保持原文。

请说明解决的问题、最终行为和验证范围。修改产品行为时同步相关验收条目；改变既有决策时更新 [DECISIONS](docs/DECISIONS.md)。跑与改动相称的检查，真实宿主未验的部分如实记录，不把离线通过写成现场通过。

新增第三方代码或素材前，请记录来源、版本、文件范围与许可。原创贡献按本仓库 [MIT License](LICENSE) 提供；第三方内容遵循 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。凭据、音频和运行数据库不得入库。
