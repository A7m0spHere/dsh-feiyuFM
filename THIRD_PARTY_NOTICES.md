# Third-party notices

## dsh-api-dashboard — MIT

The downward-swipe close behavior in `src/ui/dsh-client.js`'s `SwipeHandle` is adapted from `client/client.js` lines 92–135 of [`dsh-api-dashboard` v1.4.5, commit `3792f1547bce222260eeeca015c6e13b7d5f466e`](https://github.com/133563825as-ai/dsh-api-dashboard/blob/3792f1547bce222260eeeca015c6e13b7d5f466e/client/client.js). The panel and card styling were implemented for FishFM; no images, provider code, or account features were copied. The upstream project is MIT-licensed.

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
