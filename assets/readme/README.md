# 仓库首页素材

`hero.svg` 为本项目绘制的 1200 × 260 静态头图，沿用播放器冷灰／蓝色、系统字体和耳机标记；本轮保留。原创矢量按 MIT 提供，完整许可见[版权声明](../../THIRD_PARTY_NOTICES.md)。

四张界面图于 2026-11-05 从 main 合并提交 `21e170c` 的生产 bundle 重新截取，替换 2026-11-02 的旧图。预览命令为 `node scripts/ui-preview.mjs --react-root .tmp/react-root --port 4199`，使用已有 React 18 UMD 与 Playwright 的本机 Microsoft Edge；无需账号、模型或音频。

| 文件 | 尺寸 | SHA-256 |
|---|---|---|
| `panel.png` | 1100 × 978 | `de434c1def17bf8223482ed0020821071c71d6ff6c971faac2c4d780bbfcebfe` |
| `panel-dark.png` | 1100 × 978 | `a0de971c84e83dc39ebe520eb3153723758127955141f9a56b2b390d976f56ff` |
| `panel-narrow.png` | 360 × 1422 | `84e3007ddf3f35f8c9074c96c0df005c21b49cb740ece0c65ee18377b916be42` |
| `panel-narrow-dark.png` | 360 × 1422 | `c78ddf89f04549f259f989492d1937cf2256122f5da9c6f8d3be5afa8068c5e6` |

取景含页头、四标签、紧凑人物区、逐行歌词、可选池和底栏。仅隐藏预览工具栏／侧栏，移除预览容器的固定高度并将视口调到内容高度；歌词自身的定高滚动与响应式样式来自生产客户端。宽图展示左右分栏，窄图展示上下排列，均为暂停状态与默认原文；翻译／音译开关尚未开启。PNG 由浏览器直接输出，没有重绘产品界面。

图中歌曲、歌词、账号、曲库与模型信息均为预览样例，示例歌词由本项目编写，不能作为真实网易云歌词、推荐质量或音频验收证据。main 已含歌词，但 npm 正式版 0.1.1 尚不含此功能；日常候选和审查代码边界见 [U26](../../docs/spikes/U26-console-lyrics.md)。

角色使用生产资源路由中的 `whale-idle.png`，未复制运行素材到预览目录，未加入锅盖 GIF 或 doll。截图中的角色仍适用原署名与 CC BY-NC-SA 4.0，不因截图而改为 MIT；见[第三方声明](../../THIRD_PARTY_NOTICES.md)。

根 README 采用 GitHub 支持的 `picture/source`，按主题和宽度选图，URL 参数更新为 `v=20261105`。本地 Markdown 预览核对桌面／手机的浅深色四种组合，图片完整、选择正确、没有页面横向溢出，源码安装折叠内容可展开；浏览器未记录页面错误。旧图、取景方式与日期保留在 Git 历史中。
