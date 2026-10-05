# 第三方代码与素材声明

本项目原创代码和文档采用 [MIT License](LICENSE)，许可文本使用 [Open Source Initiative 的 MIT 原文](https://opensource.org/license/mit)。以下第三方内容保留各自的许可、版权与来源；本项目的 MIT 不改变其授权范围。依赖的完整版本与许可字段可在 `package-lock.json` 中核对。

用户提供的锅盖鲸鱼娘 GIF、`src/ui/assets/whale-pot-dance.gif`、`src/ui/assets/whale-pot-still.png` 及 README 截图中对应的角色图像，作者与许可尚未确认，**明确排除在本项目 MIT 授权范围外**。它们的处理过程不构成新的原作授权。

`assets/readme/hero.svg` 为本项目绘制的静态矢量介绍，按 MIT 提供；`panel.png` 和 `panel-dark.png` 来自 2026-10-05 当前客户端的隔离预览，展示模拟数据与暂停状态，角色使用本项目此前生成的 `whale-idle.png`，未展示上述锅盖鲸鱼娘素材。截图不构成真实账号或模型效果证据。

原有 `whale-idle.png`、`whale-listening.png` 和 `whale-dj.png` 为本项目使用 Codex ImageGen 生成的状态图，来源输出名记录在 [原型素材记录](prototypes/ASSETS.md)；项目对这些自有状态图和上述截图按 MIT 提供。

原有来源证据与英文许可原文保留如下。

## qrcode — MIT

`qrcode@1.5.4` 为二维码生成依赖，来源为 [soldair/node-qrcode](https://github.com/soldair/node-qrcode)。未复制其源文件；随 npm 安装的许可证与版权声明保留在依赖中。

## User-provided pot whale GIF

The user supplied `c01865c11357bb0e2bcc82666f35b399.png` on 2026-10-04 and requested background removal and playback UI integration. Its actual format is GIF89a, with 50 frames. `src/ui/assets/whale-pot-dance.gif` and `whale-pot-still.png` are foreground-only derivatives created from the original pixels with the locally authorized `scripts/cutout-whale-pot.py`; no generated replacement frames are used. The creator and license were not supplied, and the original attachment is not checked in. Source hash, processing scope and evidence are recorded in [U10](docs/spikes/U10-user-gif-cutout.md). OpenCV/Pillow are asset-build tools only, not plugin runtime dependencies.

## PHL design tokens and motion reference — MIT

FishFM's `src/ui/client/styles.mjs` adapts the light/dark neutral and azure values and timing vocabulary from the user's local `dsh-phl` project, inspected on 2026-10-02 at base commit `3ec73011d20d9b44c797bde302a4576b8671b1b3`: `src/index.css` and `src/lib/motion.ts`. `src/components/ui/Card.tsx`, `Button.tsx`, `Menu.tsx` and `src/components/layout/Page.tsx` were read as visual/interaction references. FishFM's components and CSS animation/presence implementation are maintained here; no PHL logo, launcher assets, Tauri code or motion library was copied or added as a runtime dependency. The local project declares MIT and includes this license:

```text
MIT License

Copyright (c) 2026 A7m0spHere

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## dsh-api-dashboard — MIT

The downward-swipe close behavior in `src/ui/client/components.mjs`'s `SwipeHandle` (bundled into `src/ui/dsh-client.js`) is adapted from `client/client.js` lines 92–135 of [`dsh-api-dashboard` v1.4.5, commit `3792f1547bce222260eeeca015c6e13b7d5f466e`](https://github.com/133563825as-ai/dsh-api-dashboard/blob/3792f1547bce222260eeeca015c6e13b7d5f466e/client/client.js). The panel and card styling were implemented for FishFM; no images, provider code, or account features were copied. The upstream project is MIT-licensed.

```text
MIT License

Copyright (c) 2026 dsh-api-dashboard contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## NetEase Cloud Music community Node API

2026-10-01 QR repair additionally calls the pinned package's `module/login_qr_key.js`, `module/login_qr_check.js`, and `util/request.js`. FishFM's wrapper preserves a request rejection which the pinned QR module's catch otherwise masks. No package source was copied or modified; the same pinned version and MIT declaration apply. Research and validation: [U6](docs/spikes/U6-qr-login-repair.md).

`@neteasecloudmusicapienhanced/api@4.40.1` is a direct runtime dependency, pinned in `package.json` and `package-lock.json`. Its npm metadata declares MIT. FishFM calls its Node modules in process and does not start the package's Express server. See [the package README](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/README.MD) and [package manifest](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/package.json). No source files from this package are copied into FishFM.

## DeepSeek Balance Whale Widget — reference only

The widget's bubble, compact status, and three-dot menu informed the FishFM overlay. No code or artwork was copied. The upstream repository states that its code is MIT-licensed while `assets/**` is outside that grant; FishFM therefore uses the project's own generated art in `src/ui/assets/`. See [upstream provenance](https://raw.githubusercontent.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/main/PROVENANCE.md).
