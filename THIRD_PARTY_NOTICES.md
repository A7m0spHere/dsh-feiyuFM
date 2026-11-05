# 版权、素材来源与第三方许可

本文件统一维护 FeiyuFM 的版权范围、角色署名、第三方代码通知和运行依赖清单。项目原创代码与文档采用 [MIT License](LICENSE)，Copyright (c) 2026 A7m0spHere；第三方代码、角色形象与素材分别适用下述条款。根目录 `LICENSE` 保留标准 MIT 原文，不能据此将整个安装包中的音乐、图像或依赖统一按 MIT 使用。

`package.json` 的 `license` 指向本文件，以标明安装包包含多种许可；这不改变项目原创代码与文档的 MIT 许可。

## 项目与平台内容

FeiyuFM 是独立维护的 DSH 社区插件，与 DeepSeek、网易云及其他相关厂商不存在官方隶属或背书关系。文中产品名称和标识用于识别相关产品，相关权利归各自权利人所有。

平台提供的音乐、歌词及相关内容不属于本项目的 MIT 授权范围。本项目不授予这些内容的复制、传播或商业使用权；播放可用性受账号权限、平台服务规则和资源状态影响。仓库与 npm 包不提供歌曲音频、歌词全文、账号凭据或运行数据库；预览中的歌词为本项目编写的示例文本。

歌词解析复用 [lrc-kit](https://github.com/weirongxu/lrc-kit) 1.2.1 的 `Lrc.parse`，采用 MIT；上游作者 Weirong Xu，源码范围为发布包的 `lib/cjs/lrc.js` 及其 `line-parser.js`（经包入口加载）。项目自行完成时间规范化、翻译／音译对齐、缓存和 React 渲染，不复制 AMLL 或其他候选实现。包版本、完整性摘要和随包许可分别由 `npm-shrinkwrap.json`、下方依赖清单及依赖原包 `LICENSE` 保留。

## 鲸鱼娘（大肥鱼）与 AI 角色图像

### 作者、原型与使用条件

- **图像与二次设计作者：@ZipZipPipe。** 用户于 2026-11-03 确认，锅盖鲸鱼娘 GIF 及其静态衍生图、六张 Workshop doll PNG 均来源于其 AI 生图作品；Workshop 是素材取得渠道。
- **鲸鱼娘原始角色：上善无形（上善）。** @ZipZipPipe 在原角色基础上加入 DeepSeek 元素进行女仆鲸鱼娘二次设计；用户提供的来源公告也注明这条关系，公告保留的原作入口为 [b23.tv/3dNz55h](https://b23.tv/3dNz55h)。
- **作者公开说明：** [Pixiv《AI娘化》](https://www.pixiv.net/artworks/148186519)，作者 [ZipZipPipe](https://www.pixiv.net/users/18604994)。2026-11-03 读取该作品的公开接口，核对作者、作品 ID 与说明：允许取用，要求标注作者、不可商用；其中 DeepSeek 娘基于“上善”的鲸鱼娘形象，遵循原作者的 CC BY-NC-SA 4.0。
- **鲸鱼娘及本项目的相关衍生图：** 按 [CC BY-NC-SA 4.0（署名—非商业性使用—相同方式共享）](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans) 使用和分发。再分发须保留上述署名、来源与许可链接，注明改动，相关改编以相同许可共享；商业使用需另行取得相应权利人的许可。完整条款见 [legal code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.zh-hans)。
- **其他角色图像：** 按 @ZipZipPipe 的“标注作者、不可商用”公开说明使用。作者对 DeepSeek 娘单列的 CC 条款不自动扩展到其他角色；本项目不另行授予这些图像的 MIT 或其他再许可。

AI 生成是图像的制作方式，不改变原角色署名与上述使用条件。下面列出的角色图像及截图中的对应形象均不在本项目 MIT 授权范围内。

### 随包文件与本项目改动

| 文件 | 取得方式与改动 | 适用说明 |
|---|---|---|
| `src/ui/assets/whale-pot-dance.gif` | 用户提供 AI 动图；本项目逐帧去背景、统一裁切、调整透明蒙版与调色板，保留 50 帧动作及时序 | 鲸鱼娘衍生图，CC BY-NC-SA 4.0；署名上善无形、ZipZipPipe，注明 FeiyuFM 抠图处理 |
| `src/ui/assets/whale-pot-still.png` | 从同一动图第 16 帧提取并去背景 | 同上 |
| `src/ui/assets/dolls/doll-deepseek.png` | 从 Workshop 原字节提取，没有重画、裁切或重采样 | 鲸鱼娘衍生图，CC BY-NC-SA 4.0；署名上善无形、ZipZipPipe |
| `src/ui/assets/dolls/doll-{glm,claude,gemini,gpt,grok}.png` | 同批 Workshop AI 角色图，原字节提取 | 署名 ZipZipPipe，非商业性使用，按作者公开说明处理 |
| `src/ui/assets/whale-idle.png`、`whale-listening.png`、`whale-dj.png` | 本项目使用 Codex ImageGen 生成的鲸鱼娘状态图，改编角色姿态与用途 | 鲸鱼娘衍生图，CC BY-NC-SA 4.0；署名上善无形、ZipZipPipe，注明 FeiyuFM AI 状态图改编 |

Workshop 来源为 [Wallpaper Engine 项目 3811739493](https://steamcommunity.com/sharedfiles/filedetails/?id=3811739493)（应用 `431960`）。六张 PNG 的尺寸、SHA-256 与提取路径见 [U12 原始清单](https://github.com/A7m0spHere/dsh-feiyuFM/blob/233bffa52309c8f0ee9bc18b88275c54c82f3aa0/docs/spikes/U12-doll-assets.json)；GIF 原附件 hash、逐帧处理和验证见 [U10](https://github.com/A7m0spHere/dsh-feiyuFM/blob/233bffa52309c8f0ee9bc18b88275c54c82f3aa0/docs/spikes/U10-user-gif-cutout.md)。上述早期记录中的“作者/许可未确认”是当时状态，作者与使用条件以本文件 2026-11-03 的补核为准。原附件不入库，普通安装无需 Wallpaper Engine 或提取脚本。壁纸 `physics.js` / `app.js` 只作运动参考，没有复制其 JavaScript、音乐或视频。

三张状态图的原输出名见 [生成来源记录](https://github.com/A7m0spHere/dsh-feiyuFM/blob/233bffa52309c8f0ee9bc18b88275c54c82f3aa0/prototypes/README.md#素材来源)。版权署名、许可与使用范围统一以上文为准。

### 仓库首页素材

`assets/readme/hero.svg` 为本项目绘制的静态矢量介绍，按 MIT 提供。`panel.png`、`panel-dark.png`、`panel-narrow.png` 和 `panel-narrow-dark.png` 于 **2026-11-02** 从源码提交 `90c0453` 的隔离预览截取，展示当前陪伴界面、模拟数据与暂停状态，使用 `whale-idle.png`，没有展示锅盖 GIF 或 doll。截图中的鲸鱼娘仍适用上文的 CC BY-NC-SA 4.0，不能将整张截图中的角色图像按 MIT 使用。取景和尺寸见 [首页素材记录](assets/readme/README.md)；截图不构成真实账号、模型效果或音频验收证据。

## 第三方代码与交互参考

## qrcode — MIT

`qrcode@1.5.4` 为二维码生成依赖，来源为 [soldair/node-qrcode](https://github.com/soldair/node-qrcode)。未修改其源文件；公开测试包封装原始运行依赖树，保留依赖中的许可证和版权声明。

## PHL design tokens and motion reference — MIT

FeiyuFM's `src/ui/client/styles.mjs` adapts the light/dark neutral and azure values and timing vocabulary from the user's local `dsh-phl` project, inspected on 2026-10-02 at base commit `3ec73011d20d9b44c797bde302a4576b8671b1b3`: `src/index.css` and `src/lib/motion.ts`. `src/components/ui/Card.tsx`, `Button.tsx`, `Menu.tsx` and `src/components/layout/Page.tsx` were read as visual/interaction references. FeiyuFM's components and CSS animation/presence implementation are maintained here; no PHL logo, launcher assets, Tauri code or motion library was copied or added as a runtime dependency. The local project declares MIT and includes this license:

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

The downward-swipe close behavior in `src/ui/client/components.mjs`'s `SwipeHandle` (bundled into `src/ui/dsh-client.js`) is adapted from `client/client.js` lines 92–135 of [`dsh-api-dashboard` v1.4.5, commit `3792f1547bce222260eeeca015c6e13b7d5f466e`](https://github.com/133563825as-ai/dsh-api-dashboard/blob/3792f1547bce222260eeeca015c6e13b7d5f466e/client/client.js). The panel and card styling were implemented for FeiyuFM; no images, provider code, or account features were copied. The upstream project is MIT-licensed.

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

2026-10-01 QR repair additionally calls the pinned package's `module/login_qr_key.js`, `module/login_qr_check.js`, and `util/request.js`. FeiyuFM's wrapper preserves a request rejection which the pinned QR module's catch otherwise masks. No upstream source was modified. Packages bundle the original runtime tree and its license files; the same pinned version and MIT declaration apply. Research and validation: [U6](https://github.com/A7m0spHere/dsh-feiyuFM/blob/233bffa52309c8f0ee9bc18b88275c54c82f3aa0/docs/spikes/U6-qr-login-repair.md).

`@neteasecloudmusicapienhanced/api@4.40.1` is a direct runtime dependency, pinned in `package.json` and `npm-shrinkwrap.json`. Its npm metadata declares MIT. FeiyuFM calls its Node modules in process and does not start the package's Express server. The distributed license retains Copyright (c) 2013-2022 Binaryify. See [the package README](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/README.MD) and [package manifest](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/package.json). The npm package includes the original runtime tree without changing upstream source; nested licenses and notice locations are listed in the runtime dependency section below.

## Navidrome / Music Assistant — interaction references only

2026-10-07 挑歌反馈参考 Navidrome `52135913d4747c8f8ddcfd8e7004202b8f53b594`（GPL-3.0）的 `LibraryScanButton.jsx`、`useScanElapsedTime.jsx`，以及 Music Assistant frontend `1e8c8c381171b7f1b9b61f037a69f2d548d61d7f`（Apache-2.0）的 `ShowCard.vue`、`useShows.ts`。只借鉴状态禁用、时间锚点与失败展示原则，没有复制代码、样式、素材或引入依赖。具体来源链接、取舍和验证见 [U16](https://github.com/A7m0spHere/dsh-feiyuFM/blob/233bffa52309c8f0ee9bc18b88275c54c82f3aa0/docs/spikes/U16-recommendation-feedback.md)。

## DeepSeek Balance Whale Widget — reference only

The widget's bubble, compact status, and three-dot menu informed the FeiyuFM overlay. No code or artwork was copied. The upstream repository states that its code is MIT-licensed while `assets/**` is outside that grant; FeiyuFM uses the separately generated character derivatives documented above in `src/ui/assets/`, subject to their character-art terms. See [upstream provenance](https://raw.githubusercontent.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/main/PROVENANCE.md).

## Pixel-whale ASCII frames — BSD-3-Clause

`src/ui/client/spectrum-whale.mjs` 里的鲸鱼字母格（`WHALE_POSES` 的 `standard` / `fin` / `tail` / `spout` 四个 18×9 姿态）是上游手绘像素鲸鱼的降采样衍生：原作为 [lhh010/dsh-ui-whale 的帧文件](https://github.com/lhh010/dsh-ui-whale/blob/b3268f81b5a9cb95d7b500a88735258ec8fbe637/sprites/whale-frames.json)（作者 @lhh010，BSD-3-Clause），经 [dsh-TUI 的 `whaleFrames.ts`](https://github.com/ccch1mneyyy/dsh-TUI/blob/12a2ae6f152d10935ddf0a9d41d4f4eb840d8a6f/src/components/whaleFrames.ts)（MIT；22 帧 40×25 字母格，含 `standard`/`fin1`/`tail3`/`spout4`）读取。这两个提交分别是对应文件在 2026-10-28 之前的最近修改版本，作为补核后的固定来源入口，不将其写成当时完整仓库 HEAD 的实测值。本项目在 2026-10-28 取轮廓信息，按包围盒做块多数决降采样到 18 宽，并重写配色映射（`@`/`%`/`o`/`-`）与全部渲染、状态机与合成代码。

- 复用范围：仅上述四个姿态的**降采样轮廓**；未复制上游的调色板、ANSI 编码、Ink 组件、`whaleIdle.ts` 行为、`whaleGirl` 素材或其 `frames.json`。
- 上游 `assets/whaleGirl/` 是用户提供的表情包 GIF 转制，**不在本次复用范围**。
- 本项目 MIT 不改变上述帧的 BSD-3-Clause 授权；再分发时须保留下列版权、条件与免责声明，并保留中转项目的 MIT 通知。取舍见 [U22](https://github.com/A7m0spHere/dsh-feiyuFM/blob/233bffa52309c8f0ee9bc18b88275c54c82f3aa0/docs/spikes/U22-ascii-spectrum-backdrop.md)。

```text
BSD 3-Clause License

Copyright (c) 2026, lhh010

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## dsh-TUI 中转帧 — MIT

保留中转项目固定版本的 [MIT 原文](https://github.com/ccch1mneyyy/dsh-TUI/blob/12a2ae6f152d10935ddf0a9d41d4f4eb840d8a6f/LICENSE)；原始像素鲸鱼的 BSD-3-Clause 通知同时保留在上一节。

```text
MIT License

Copyright (c) 2026, chimney (ccch1mneyyy)

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

## 封装依赖的许可说明

npm 包封装 `npm-shrinkwrap.json` 锁定的运行依赖，保留各依赖原有源码、版权与许可文件。下表列出安装包内的位置；这些 `node_modules/` 路径用于本机安装副本，不是 GitHub 源码目录。依赖声明与本文件中的补充原文共同适用，不能只读取 npm 的 `license` 字段。

发行打包对 `get-uri@6.0.5`（MIT，来源为锁文件记录的 npm 包）的 `package.json` 做一处元数据修订：将 `basic-ftp` 声明从 `^5.0.2` 同步为本项目既有 override `6.2.2`，并同步发行树内部的 shrinkwrap 声明。消费端不会继承依赖包的顶层 overrides，这一同步使声明与实际封装的替换版本一致。修改只发生在临时发行树，不修改工作区依赖；`get-uri`／`basic-ftp` 的 JavaScript、包版本和许可原文保持原样，整包摘要覆盖该修订。

`node-forge` 采用其双许可中的 BSD-3-Clause 选项。`node-windows@1.0.0-beta.8` 还携带 Sudowin（BSD-3-Clause，随包原文 `node_modules/node-windows/bin/sudowin/LICENSE.txt`）与 WinSW（MIT，补充原文见下文），顶层 MIT 不覆盖这些工具的独立通知。

### LGPL-3.0-only：@unblockneteasemusic/server

- 版本 `0.28.0`，来源 [UnblockNeteaseMusic/server](https://github.com/UnblockNeteaseMusic/server)，由 `@neteasecloudmusicapienhanced/api` → `@neteasecloudmusicapienhanced/unblockmusic-utils` 的依赖链带入；不是本项目原创代码，FeiyuFM 未修改其源码。
- 安装包中的库位于 `node_modules/@unblockneteasemusic/server/`。完整 JavaScript 源码在 `src/`，包入口为 `src/provider/match.js`；构建说明与配置随原包保留。`COPYING` 为 GPLv3 原文，`COPYING.LESSER` 为 LGPLv3 的附加许可，两份均保留。
- 可完整退出 DSH，在实际插件安装目录中定位上述库，修改或替换其中接口兼容的源码，再重新启动插件。该库没有被内联进 `src/ui/dsh-client.js`；本项目允许为修改该库及调试这些修改而进行必要的替换和逆向工程。插件升级可能覆盖本机修改，应自行保留补丁。
- 再分发原库或修改版本时保留原版权、两份许可与相应源码；修改版本注明改动并按 LGPL 条款处理。本项目的 MIT 不替代这项义务。[LGPLv3 全文](https://www.gnu.org/licenses/lgpl-3.0.html)。

<a id="saxes-license"></a>

### saxes 6.0.0 — ISC 补充原文

该 npm 版本声明 ISC，但没有随包附带完整许可文件。以下原文取自上游 [v6.0.0/LICENSE](https://github.com/lddubeau/saxes/blob/v6.0.0/LICENSE)，包括原始 sax 署名与上游保留的历史通知；未改写其版权归属。

```text
The ISC License

Copyright (c) Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

====

The following license is the one that governed sax, from which saxes
was forked. Isaac Schlueter is not *directly* involved with saxes so
don't go bugging him for saxes issues.

The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

====

`String.fromCodePoint` by Mathias Bynens is no longer used, but it can
still be found in old commits. It was once used according to terms of
MIT License, as follows:

    Copyright Mathias Bynens <https://mathiasbynens.be/>

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
    LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
    OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
    WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### WinSW 1.17 — MIT 补充原文

`node_modules/node-windows/bin/winsw/winsw.exe` 的产品版本为 `1.17.0.0`，二进制版本信息保留 Sun Microsystems / CloudBees 版权。以下为上游 [v1.17/LICENSE.txt](https://github.com/winsw/winsw/blob/v1.17/LICENSE.txt) 的原文，补足顶层 `node-windows` 许可没有展开的工具通知。

```text
 Copyright (c) 2010 Kohsuke Kawaguchi, Sun Microsystems, Inc., CloudBees, Inc.

 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
```

### 占位包

`gzip@0.1.0` 的 `src/gzip.js`、`test/test.js` 均为空文件，`https@1.0.0` 只有 `package.json`；它们分别在元数据中声明 MIT、ISC，没有随包的独立许可正文或实现代码。清单明确保留该状态，不将其写成已找到原许可。生成器只对这两个锁定版本且文件仍为空/仅元数据的情况放行；出现实现代码或版本变化时须重新核对。

<a id="runtime-dependencies"></a>

## 运行依赖清单

此节由 `node scripts/dependency-notices.mjs` 更新；手写的角色来源、许可原文与补充通知保留在生成区之外。许可文件名、README 许可段落及子目录通知均参与核对。

<!-- BEGIN GENERATED DEPENDENCY NOTICES -->

共 288 个锁定运行依赖条目。下列路径相对于插件安装目录。

| Package | Version | Declared license | 随包原文或补充通知 |
|---|---|---|---|
| @asamuzakjp/css-color | 3.2.0 | MIT | `node_modules/@asamuzakjp/css-color/LICENSE` |
| @borewit/text-codec | 0.2.2 | MIT | `node_modules/@borewit/text-codec/LICENSE.txt` |
| @csstools/color-helpers | 5.1.0 | MIT-0 | `node_modules/@csstools/color-helpers/LICENSE.md` |
| @csstools/css-calc | 2.1.4 | MIT | `node_modules/@csstools/css-calc/LICENSE.md` |
| @csstools/css-color-parser | 3.1.0 | MIT | `node_modules/@csstools/css-color-parser/LICENSE.md` |
| @csstools/css-parser-algorithms | 3.0.5 | MIT | `node_modules/@csstools/css-parser-algorithms/LICENSE.md` |
| @csstools/css-tokenizer | 3.0.4 | MIT | `node_modules/@csstools/css-tokenizer/LICENSE.md` |
| @neteasecloudmusicapienhanced/api | 4.40.1 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/LICENSE` |
| @neteasecloudmusicapienhanced/unblockmusic-utils | 0.4.4 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/LICENSE` |
| @tokenizer/inflate | 0.4.1 | MIT | `node_modules/@tokenizer/inflate/LICENSE` |
| @tokenizer/token | 0.3.0 | MIT | `node_modules/@tokenizer/token/README.md` |
| @tootallnate/quickjs-emscripten | 0.23.0 | MIT | `node_modules/@tootallnate/quickjs-emscripten/LICENSE` |
| @unblockneteasemusic/server | 0.28.0 | LGPL-3.0-only | `node_modules/@unblockneteasemusic/server/COPYING`；`node_modules/@unblockneteasemusic/server/COPYING.LESSER` |
| accepts | 1.3.8 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/accepts/LICENSE` |
| accepts | 2.0.0 | MIT | `node_modules/accepts/LICENSE` |
| agent-base | 6.0.2 | MIT | `node_modules/agent-base/README.md` |
| agent-base | 7.1.4 | MIT | `node_modules/http-proxy-agent/node_modules/agent-base/LICENSE` |
| agent-base | 7.1.4 | MIT | `node_modules/jsdom/node_modules/agent-base/LICENSE` |
| agent-base | 7.1.4 | MIT | `node_modules/pac-proxy-agent/node_modules/agent-base/LICENSE` |
| agent-base | 7.1.4 | MIT | `node_modules/socks-proxy-agent/node_modules/agent-base/LICENSE` |
| ansi-regex | 5.0.1 | MIT | `node_modules/ansi-regex/license` |
| ansi-regex | 6.4.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/ansi-regex/license` |
| ansi-styles | 3.2.1 | MIT | `node_modules/chalk/node_modules/ansi-styles/license` |
| ansi-styles | 4.3.0 | MIT | `node_modules/ansi-styles/license` |
| ansi-styles | 6.2.3 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/ansi-styles/license` |
| args | 5.0.3 | MIT | `node_modules/args/LICENSE` |
| array-flatten | 1.1.1 | MIT | `node_modules/array-flatten/LICENSE` |
| ast-types | 0.13.4 | MIT | `node_modules/ast-types/LICENSE` |
| asynckit | 0.4.0 | MIT | `node_modules/asynckit/LICENSE` |
| atomic-sleep | 1.0.0 | MIT | `node_modules/atomic-sleep/LICENSE` |
| axios | 1.20.0 | MIT | `node_modules/axios/LICENSE` |
| basic-ftp | 6.2.2 | MIT | `node_modules/basic-ftp/LICENSE.txt` |
| body-parser | 1.20.8 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/body-parser/LICENSE` |
| body-parser | 2.3.0 | MIT | `node_modules/body-parser/LICENSE` |
| busboy | 1.6.0 | MIT | `node_modules/busboy/LICENSE` |
| bytes | 3.1.2 | MIT | `node_modules/bytes/LICENSE` |
| call-bind-apply-helpers | 1.0.2 | MIT | `node_modules/call-bind-apply-helpers/LICENSE` |
| call-bound | 1.0.4 | MIT | `node_modules/call-bound/LICENSE` |
| camelcase | 5.0.0 | MIT | `node_modules/args/node_modules/camelcase/license` |
| camelcase | 5.3.1 | MIT | `node_modules/camelcase/license` |
| chalk | 2.4.2 | MIT | `node_modules/chalk/license` |
| cliui | 6.0.0 | ISC | `node_modules/cliui/LICENSE.txt` |
| cliui | 8.0.1 | ISC | `node_modules/node-windows/node_modules/cliui/LICENSE.txt` |
| cliui | 9.0.1 | ISC | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/cliui/LICENSE.txt` |
| color-convert | 1.9.3 | MIT | `node_modules/chalk/node_modules/color-convert/LICENSE` |
| color-convert | 2.0.1 | MIT | `node_modules/color-convert/LICENSE` |
| color-name | 1.1.3 | MIT | `node_modules/chalk/node_modules/color-name/LICENSE` |
| color-name | 1.1.4 | MIT | `node_modules/color-name/LICENSE` |
| colorette | 2.0.20 | MIT | `node_modules/colorette/LICENSE.md` |
| combined-stream | 1.0.8 | MIT | `node_modules/combined-stream/License` |
| content-disposition | 0.5.4 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/content-disposition/LICENSE` |
| content-disposition | 1.1.0 | MIT | `node_modules/content-disposition/LICENSE` |
| content-type | 1.0.5 | MIT | `node_modules/content-type/LICENSE` |
| content-type | 2.1.0 | MIT | `node_modules/body-parser/node_modules/content-type/LICENSE` |
| content-type | 2.1.0 | MIT | `node_modules/music-metadata/node_modules/content-type/LICENSE` |
| content-type | 2.1.0 | MIT | `node_modules/negotiator/node_modules/content-type/LICENSE` |
| content-type | 2.1.0 | MIT | `node_modules/type-is/node_modules/content-type/LICENSE` |
| cookie | 0.7.2 | MIT | `node_modules/cookie/LICENSE` |
| cookie-signature | 1.0.7 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/cookie-signature/Readme.md` |
| cookie-signature | 1.2.2 | MIT | `node_modules/cookie-signature/LICENSE` |
| crypto-js | 4.2.0 | MIT | `node_modules/crypto-js/LICENSE` |
| cssstyle | 4.6.0 | MIT | `node_modules/cssstyle/LICENSE` |
| data-uri-to-buffer | 6.0.2 | MIT | `node_modules/data-uri-to-buffer/LICENSE` |
| data-urls | 5.0.0 | MIT | `node_modules/data-urls/LICENSE.txt` |
| dateformat | 4.6.3 | MIT | `node_modules/dateformat/LICENSE` |
| debug | 2.6.9 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/debug/LICENSE`；`node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/debug/README.md` |
| debug | 4.4.3 | MIT | `node_modules/debug/LICENSE`；`node_modules/debug/README.md` |
| decamelize | 1.2.0 | MIT | `node_modules/decamelize/license` |
| decimal.js | 10.6.0 | MIT | `node_modules/decimal.js/LICENCE.md` |
| degenerator | 5.0.1 | MIT | `node_modules/degenerator/README.md` |
| delayed-stream | 1.0.0 | MIT | `node_modules/delayed-stream/License` |
| depd | 2.0.0 | MIT | `node_modules/depd/LICENSE` |
| destroy | 1.2.0 | MIT | `node_modules/destroy/LICENSE` |
| dijkstrajs | 1.0.3 | MIT | `node_modules/dijkstrajs/LICENSE.md` |
| dotenv | 17.4.2 | BSD-2-Clause | `node_modules/dotenv/LICENSE` |
| dunder-proto | 1.0.1 | MIT | `node_modules/dunder-proto/LICENSE` |
| duplexify | 4.1.3 | MIT | `node_modules/duplexify/LICENSE` |
| ee-first | 1.1.1 | MIT | `node_modules/ee-first/LICENSE` |
| emoji-regex | 10.6.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/emoji-regex/LICENSE-MIT.txt` |
| emoji-regex | 8.0.0 | MIT | `node_modules/emoji-regex/LICENSE-MIT.txt` |
| encodeurl | 2.0.0 | MIT | `node_modules/encodeurl/LICENSE` |
| end-of-stream | 1.4.5 | MIT | `node_modules/end-of-stream/LICENSE` |
| entities | 6.0.1 | BSD-2-Clause | `node_modules/entities/LICENSE` |
| es-define-property | 1.0.1 | MIT | `node_modules/es-define-property/LICENSE` |
| es-errors | 1.3.0 | MIT | `node_modules/es-errors/LICENSE` |
| es-object-atoms | 1.1.2 | MIT | `node_modules/es-object-atoms/LICENSE` |
| es-set-tostringtag | 2.1.0 | MIT | `node_modules/es-set-tostringtag/LICENSE` |
| escalade | 3.2.0 | MIT | `node_modules/escalade/license` |
| escape-html | 1.0.3 | MIT | `node_modules/escape-html/LICENSE` |
| escape-string-regexp | 1.0.5 | MIT | `node_modules/escape-string-regexp/license` |
| escodegen | 2.1.0 | BSD-2-Clause | `node_modules/escodegen/LICENSE.BSD` |
| esprima | 4.0.1 | BSD-2-Clause | `node_modules/esprima/LICENSE.BSD` |
| estraverse | 5.3.0 | BSD-2-Clause | `node_modules/estraverse/LICENSE.BSD` |
| esutils | 2.0.3 | BSD-2-Clause | `node_modules/esutils/LICENSE.BSD` |
| etag | 1.8.1 | MIT | `node_modules/etag/LICENSE` |
| express | 4.22.3 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/express/LICENSE` |
| express | 5.2.1 | MIT | `node_modules/express/LICENSE` |
| express-fileupload | 1.5.2 | MIT | `node_modules/express-fileupload/LICENSE` |
| fast-redact | 3.5.0 | MIT | `node_modules/fast-redact/LICENSE` |
| fast-safe-stringify | 2.1.1 | MIT | `node_modules/fast-safe-stringify/LICENSE` |
| file-type | 21.3.4 | MIT | `node_modules/file-type/license` |
| finalhandler | 1.3.2 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/finalhandler/LICENSE` |
| finalhandler | 2.1.1 | MIT | `node_modules/finalhandler/LICENSE` |
| find-up | 4.1.0 | MIT | `node_modules/find-up/license` |
| flatstr | 1.0.12 | MIT | `node_modules/flatstr/LICENSE` |
| follow-redirects | 1.16.0 | MIT | `node_modules/follow-redirects/LICENSE` |
| form-data | 4.0.6 | MIT | `node_modules/form-data/License` |
| forwarded | 0.2.0 | MIT | `node_modules/forwarded/LICENSE` |
| fresh | 0.5.2 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/fresh/LICENSE` |
| fresh | 2.0.0 | MIT | `node_modules/fresh/LICENSE` |
| function-bind | 1.1.2 | MIT | `node_modules/function-bind/LICENSE` |
| get-caller-file | 2.0.5 | ISC | `node_modules/get-caller-file/LICENSE.md` |
| get-east-asian-width | 1.7.0 | MIT | `node_modules/get-east-asian-width/license` |
| get-intrinsic | 1.3.0 | MIT | `node_modules/get-intrinsic/LICENSE` |
| get-proto | 1.0.1 | MIT | `node_modules/get-proto/LICENSE` |
| get-uri | 6.0.5 | MIT | `node_modules/get-uri/LICENSE` |
| gopd | 1.2.0 | MIT | `node_modules/gopd/LICENSE` |
| gzip | 0.1.0 | MIT | 占位包，仅元数据/空文件；许可声明见 `node_modules/gzip/package.json` |
| has-flag | 3.0.0 | MIT | `node_modules/has-flag/license` |
| has-symbols | 1.1.0 | MIT | `node_modules/has-symbols/LICENSE` |
| has-tostringtag | 1.0.2 | MIT | `node_modules/has-tostringtag/LICENSE` |
| hasown | 2.0.4 | MIT | `node_modules/hasown/LICENSE` |
| html-encoding-sniffer | 4.0.0 | MIT | `node_modules/html-encoding-sniffer/LICENSE.txt` |
| http-errors | 2.0.1 | MIT | `node_modules/http-errors/LICENSE` |
| http-proxy-agent | 7.0.2 | MIT | `node_modules/http-proxy-agent/LICENSE` |
| https | 1.0.0 | ISC | 占位包，仅元数据/空文件；许可声明见 `node_modules/https/package.json` |
| https-proxy-agent | 5.0.1 | MIT | `node_modules/https-proxy-agent/README.md` |
| https-proxy-agent | 7.0.6 | MIT | `node_modules/jsdom/node_modules/https-proxy-agent/LICENSE` |
| https-proxy-agent | 7.0.6 | MIT | `node_modules/pac-proxy-agent/node_modules/https-proxy-agent/LICENSE` |
| iconv-lite | 0.4.24 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/iconv-lite/LICENSE` |
| iconv-lite | 0.6.3 | MIT | `node_modules/whatwg-encoding/node_modules/iconv-lite/LICENSE` |
| iconv-lite | 0.7.3 | MIT | `node_modules/iconv-lite/LICENSE` |
| ieee754 | 1.2.1 | BSD-3-Clause | `node_modules/ieee754/LICENSE` |
| inherits | 2.0.4 | ISC | `node_modules/inherits/LICENSE` |
| ip-address | 10.7.2 | MIT | `node_modules/ip-address/LICENSE` |
| ipaddr.js | 1.9.1 | MIT | `node_modules/ipaddr.js/LICENSE` |
| is-fullwidth-code-point | 3.0.0 | MIT | `node_modules/is-fullwidth-code-point/license` |
| is-potential-custom-element-name | 1.0.1 | MIT | `node_modules/is-potential-custom-element-name/LICENSE-MIT.txt` |
| is-promise | 4.0.0 | MIT | `node_modules/is-promise/LICENSE` |
| joycon | 3.1.1 | MIT | `node_modules/joycon/LICENSE` |
| jsdom | 24.1.3 | MIT | `node_modules/jsdom/LICENSE.txt` |
| leven | 2.1.0 | MIT | `node_modules/leven/license` |
| locate-path | 5.0.0 | MIT | `node_modules/locate-path/license` |
| lrc-kit | 1.2.1 | MIT | `node_modules/lrc-kit/LICENSE` |
| lru-cache | 10.4.3 | ISC | `node_modules/lru-cache/LICENSE` |
| math-intrinsics | 1.1.0 | MIT | `node_modules/math-intrinsics/LICENSE` |
| media-typer | 0.3.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/media-typer/LICENSE` |
| media-typer | 1.1.1 | MIT | `node_modules/type-is/node_modules/media-typer/LICENSE` |
| media-typer | 2.0.0 | MIT | `node_modules/media-typer/LICENSE` |
| merge-descriptors | 1.0.3 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/merge-descriptors/LICENSE` |
| merge-descriptors | 2.0.0 | MIT | `node_modules/merge-descriptors/license` |
| methods | 1.1.2 | MIT | `node_modules/methods/LICENSE` |
| mime | 1.6.0 | MIT | `node_modules/mime/LICENSE` |
| mime-db | 1.52.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/mime-db/LICENSE` |
| mime-db | 1.52.0 | MIT | `node_modules/form-data/node_modules/mime-db/LICENSE` |
| mime-db | 1.54.0 | MIT | `node_modules/mime-db/LICENSE` |
| mime-types | 2.1.35 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/mime-types/LICENSE` |
| mime-types | 2.1.35 | MIT | `node_modules/form-data/node_modules/mime-types/LICENSE` |
| mime-types | 3.0.2 | MIT | `node_modules/mime-types/LICENSE` |
| mri | 1.1.4 | MIT | `node_modules/mri/license.md` |
| ms | 2.0.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/debug/node_modules/ms/license.md` |
| ms | 2.1.3 | MIT | `node_modules/ms/license.md` |
| music-metadata | 11.16.1 | MIT | `node_modules/music-metadata/LICENSE.txt` |
| negotiator | 0.6.3 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/negotiator/LICENSE` |
| negotiator | 1.1.0 | MIT | `node_modules/negotiator/LICENSE` |
| netmask | 2.1.1 | MIT | `node_modules/netmask/LICENSE.md`；`node_modules/netmask/README.md` |
| node-forge | 1.4.0 | (BSD-3-Clause OR GPL-2.0) | `node_modules/node-forge/LICENSE` |
| node-windows | 1.0.0-beta.8 | MIT | `node_modules/node-windows/bin/sudowin/LICENSE.txt`；`node_modules/node-windows/LICENSE`；`node_modules/node-windows/README.md` |
| nwsapi | 2.2.28 | MIT | `node_modules/nwsapi/LICENSE` |
| object-inspect | 1.13.4 | MIT | `node_modules/object-inspect/LICENSE` |
| on-exit-leak-free | 0.2.0 | MIT | `node_modules/on-exit-leak-free/LICENSE` |
| on-finished | 2.4.1 | MIT | `node_modules/on-finished/LICENSE` |
| once | 1.4.0 | ISC | `node_modules/once/LICENSE` |
| p-limit | 2.3.0 | MIT | `node_modules/p-limit/license` |
| p-locate | 4.1.0 | MIT | `node_modules/p-locate/license` |
| p-try | 2.2.0 | MIT | `node_modules/p-try/license` |
| pac-proxy-agent | 7.2.0 | MIT | `node_modules/pac-proxy-agent/LICENSE` |
| pac-resolver | 7.0.1 | MIT | `node_modules/pac-resolver/LICENSE` |
| parse5 | 7.3.0 | MIT | `node_modules/parse5/LICENSE` |
| parseurl | 1.3.3 | MIT | `node_modules/parseurl/LICENSE` |
| path-exists | 4.0.0 | MIT | `node_modules/path-exists/license` |
| path-to-regexp | 0.1.13 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/path-to-regexp/LICENSE` |
| path-to-regexp | 8.4.2 | MIT | `node_modules/path-to-regexp/LICENSE` |
| pino | 6.14.0 | MIT | `node_modules/pino/LICENSE` |
| pino-abstract-transport | 0.5.0 | MIT | `node_modules/pino-abstract-transport/LICENSE` |
| pino-pretty | 7.6.1 | MIT | `node_modules/pino-pretty/LICENSE` |
| pino-std-serializers | 3.2.0 | MIT | `node_modules/pino-std-serializers/LICENSE` |
| pngjs | 5.0.0 | MIT | `node_modules/pngjs/LICENSE`；`node_modules/pngjs/README.md` |
| process-warning | 1.0.0 | MIT | `node_modules/process-warning/LICENSE` |
| proxy-addr | 2.0.8 | MIT | `node_modules/proxy-addr/LICENSE` |
| proxy-from-env | 2.1.0 | MIT | `node_modules/proxy-from-env/LICENSE` |
| psl | 1.15.0 | MIT | `node_modules/psl/LICENSE`；`node_modules/psl/README.md` |
| pump | 3.0.4 | MIT | `node_modules/pump/LICENSE` |
| punycode | 2.3.1 | MIT | `node_modules/punycode/LICENSE-MIT.txt` |
| qrcode | 1.5.4 | MIT | `node_modules/qrcode/license` |
| qs | 6.16.0 | BSD-3-Clause | `node_modules/qs/LICENSE.md` |
| querystringify | 2.2.0 | MIT | `node_modules/querystringify/LICENSE` |
| quick-format-unescaped | 4.0.4 | MIT | `node_modules/quick-format-unescaped/LICENSE` |
| range-parser | 1.2.1 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/range-parser/LICENSE` |
| range-parser | 1.3.0 | MIT | `node_modules/range-parser/LICENSE` |
| raw-body | 2.5.3 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/raw-body/LICENSE` |
| raw-body | 3.0.2 | MIT | `node_modules/raw-body/LICENSE` |
| readable-stream | 3.6.2 | MIT | `node_modules/readable-stream/LICENSE` |
| require-directory | 2.1.1 | MIT | `node_modules/require-directory/LICENSE` |
| require-main-filename | 2.0.0 | ISC | `node_modules/require-main-filename/LICENSE.txt` |
| requires-port | 1.0.0 | MIT | `node_modules/requires-port/LICENSE` |
| rfdc | 1.4.1 | MIT | `node_modules/rfdc/LICENSE` |
| router | 2.2.0 | MIT | `node_modules/router/LICENSE` |
| rrweb-cssom | 0.7.1 | MIT | `node_modules/rrweb-cssom/LICENSE.txt` |
| rrweb-cssom | 0.8.0 | MIT | `node_modules/cssstyle/node_modules/rrweb-cssom/LICENSE.txt` |
| safe-buffer | 5.2.1 | MIT | `node_modules/safe-buffer/LICENSE` |
| safe-decode-uri-component | 1.2.1 | MIT | `node_modules/safe-decode-uri-component/LICENSE` |
| safer-buffer | 2.1.2 | MIT | `node_modules/safer-buffer/LICENSE` |
| sax | 1.6.1 | BlueOak-1.0.0 | `node_modules/sax/LICENSE.md` |
| saxes | 6.0.0 | ISC | [本文保留的上游许可](#saxes-license) |
| secure-json-parse | 2.7.0 | BSD-3-Clause | `node_modules/secure-json-parse/LICENSE.md` |
| send | 0.19.2 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/send/LICENSE` |
| send | 1.2.1 | MIT | `node_modules/send/LICENSE` |
| serve-static | 1.16.3 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/serve-static/LICENSE` |
| serve-static | 2.2.1 | MIT | `node_modules/serve-static/LICENSE` |
| set-blocking | 2.0.0 | ISC | `node_modules/set-blocking/LICENSE.txt` |
| setprototypeof | 1.2.0 | ISC | `node_modules/setprototypeof/LICENSE` |
| side-channel | 1.1.1 | MIT | `node_modules/side-channel/LICENSE` |
| side-channel-list | 1.0.1 | MIT | `node_modules/side-channel-list/LICENSE` |
| side-channel-map | 1.0.1 | MIT | `node_modules/side-channel-map/LICENSE` |
| side-channel-weakmap | 1.0.2 | MIT | `node_modules/side-channel-weakmap/LICENSE` |
| smart-buffer | 4.2.0 | MIT | `node_modules/smart-buffer/LICENSE` |
| socks | 2.8.10 | MIT | `node_modules/socks/LICENSE` |
| socks-proxy-agent | 8.0.5 | MIT | `node_modules/socks-proxy-agent/LICENSE` |
| sonic-boom | 1.4.1 | MIT | `node_modules/sonic-boom/LICENSE` |
| sonic-boom | 2.8.0 | MIT | `node_modules/pino-pretty/node_modules/sonic-boom/LICENSE` |
| source-map | 0.6.1 | BSD-3-Clause | `node_modules/source-map/LICENSE` |
| split2 | 4.2.0 | ISC | `node_modules/split2/LICENSE`；`node_modules/split2/README.md` |
| statuses | 2.0.2 | MIT | `node_modules/statuses/LICENSE` |
| stream-shift | 1.0.3 | MIT | `node_modules/stream-shift/LICENSE` |
| streamsearch | 1.1.0 | MIT | `node_modules/streamsearch/LICENSE` |
| string_decoder | 1.3.0 | MIT | `node_modules/string_decoder/LICENSE` |
| string-width | 4.2.3 | MIT | `node_modules/string-width/license` |
| string-width | 7.2.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/cliui/node_modules/string-width/license` |
| string-width | 7.2.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/wrap-ansi/node_modules/string-width/license` |
| string-width | 8.3.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/string-width/license` |
| strip-ansi | 6.0.1 | MIT | `node_modules/strip-ansi/license` |
| strip-ansi | 7.2.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/strip-ansi/license` |
| strip-json-comments | 3.1.1 | MIT | `node_modules/strip-json-comments/license` |
| strtok3 | 10.3.5 | MIT | `node_modules/strtok3/LICENSE.txt` |
| supports-color | 5.5.0 | MIT | `node_modules/supports-color/license` |
| symbol-tree | 3.2.4 | MIT | `node_modules/symbol-tree/LICENSE` |
| toidentifier | 1.0.1 | MIT | `node_modules/toidentifier/LICENSE` |
| token-types | 6.1.2 | MIT | `node_modules/token-types/LICENSE.txt` |
| tough-cookie | 4.1.4 | BSD-3-Clause | `node_modules/tough-cookie/LICENSE` |
| tr46 | 5.1.1 | MIT | `node_modules/tr46/LICENSE.md` |
| tslib | 2.8.1 | 0BSD | `node_modules/tslib/LICENSE.txt` |
| tunnel | 0.0.6 | MIT | `node_modules/tunnel/LICENSE` |
| type-is | 1.6.18 | MIT | `node_modules/@neteasecloudmusicapienhanced/unblockmusic-utils/node_modules/type-is/LICENSE` |
| type-is | 2.1.0 | MIT | `node_modules/type-is/LICENSE` |
| uint8array-extras | 1.6.0 | MIT | `node_modules/uint8array-extras/license` |
| universalify | 0.2.0 | MIT | `node_modules/universalify/LICENSE` |
| unpipe | 1.0.0 | MIT | `node_modules/unpipe/LICENSE` |
| url-parse | 1.5.10 | MIT | `node_modules/url-parse/LICENSE` |
| util-deprecate | 1.0.2 | MIT | `node_modules/util-deprecate/LICENSE`；`node_modules/util-deprecate/README.md` |
| utils-merge | 1.0.1 | MIT | `node_modules/utils-merge/LICENSE` |
| vary | 1.1.2 | MIT | `node_modules/vary/LICENSE` |
| w3c-xmlserializer | 5.0.0 | MIT | `node_modules/w3c-xmlserializer/LICENSE.md` |
| webidl-conversions | 7.0.0 | BSD-2-Clause | `node_modules/webidl-conversions/LICENSE.md` |
| whatwg-encoding | 3.1.1 | MIT | `node_modules/whatwg-encoding/LICENSE.txt` |
| whatwg-mimetype | 4.0.0 | MIT | `node_modules/whatwg-mimetype/LICENSE.txt` |
| whatwg-url | 14.2.0 | MIT | `node_modules/whatwg-url/LICENSE.txt` |
| which-module | 2.0.1 | ISC | `node_modules/which-module/LICENSE` |
| win-guid | 0.2.1 | MIT | `node_modules/win-guid/LICENSE.txt` |
| wrap-ansi | 6.2.0 | MIT | `node_modules/wrap-ansi/license` |
| wrap-ansi | 7.0.0 | MIT | `node_modules/node-windows/node_modules/wrap-ansi/license` |
| wrap-ansi | 9.0.2 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/wrap-ansi/license` |
| wrappy | 1.0.2 | ISC | `node_modules/wrappy/LICENSE` |
| ws | 8.22.0 | MIT | `node_modules/ws/LICENSE` |
| xml | 1.0.1 | MIT | `node_modules/xml/LICENSE` |
| xml-name-validator | 5.0.0 | Apache-2.0 | `node_modules/xml-name-validator/LICENSE.txt` |
| xml2js | 0.6.2 | MIT | `node_modules/xml2js/LICENSE` |
| xmlbuilder | 11.0.1 | MIT | `node_modules/xmlbuilder/LICENSE` |
| xmlchars | 2.2.0 | MIT | `node_modules/xmlchars/LICENSE` |
| y18n | 4.0.3 | ISC | `node_modules/y18n/LICENSE` |
| y18n | 5.0.8 | ISC | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/y18n/LICENSE` |
| y18n | 5.0.8 | ISC | `node_modules/node-windows/node_modules/y18n/LICENSE` |
| yargs | 15.4.1 | MIT | `node_modules/yargs/LICENSE` |
| yargs | 17.7.3 | MIT | `node_modules/node-windows/node_modules/yargs/LICENSE` |
| yargs | 18.2.0 | MIT | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/yargs/LICENSE` |
| yargs-parser | 18.1.3 | ISC | `node_modules/yargs-parser/LICENSE.txt` |
| yargs-parser | 21.1.1 | ISC | `node_modules/node-windows/node_modules/yargs-parser/LICENSE.txt` |
| yargs-parser | 22.0.0 | ISC | `node_modules/@neteasecloudmusicapienhanced/api/node_modules/yargs-parser/LICENSE.txt` |

<!-- END GENERATED DEPENDENCY NOTICES -->

## 版权问题反馈

如需核对署名、来源或使用范围，请通过 [GitHub Issues](https://github.com/A7m0spHere/dsh-feiyuFM/issues) 提供作品出处和涉及的文件。确认需要调整时，更新本文件及相关素材。
