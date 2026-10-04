# U9 鲸鱼娘背景融合与生成帧动画

2026-10-04，用户要求移除播放器中鲸鱼娘的独立蓝色底块，并用 image 生成更多图片制作 GIF。

## 当前版本：32 帧

2026-10-04 用户要求至少 30 帧。重新使用内置 `image_gen` 生成更多动作：最终选中的 `docs/art/whale-motion-v2.png` 实际为 6+6+7+6+7，共 32 个姿势（提示词请求 36，按实际输出计数）。第一次 28 格输出未采用。

`scripts/build-whale-animation.py` 根据选中图集的透明行间隙裁切；输出 `src/ui/assets/whale-listening-loop-v2.gif` 与 `whale-loop-still-v2.png`。GIF 256×320、32 帧，首帧 600ms、末帧 250ms、中间 30 帧各 70ms，合计 2950ms。逐帧解码后 32 个 RGBA SHA-256 均不同，脚本会在少于 32 个实际/不同帧时失败。保持同一脚底基线、共用调色板和透明清除。使用版本化 URL 避免浏览器缓存旧动画，原版仍留存。

32 帧版相关 23 项测试、113 模块检查与构建通过；生产宿主仍未重载，真实宿主显示未验。以下初版的隔离浏览器结果不冒充新版宿主验证。

当前版本完整生成提示词（内置工具，`transparent_background=true`，参考初版 `whale-loop-still.png`）：

```text
Use case: identity-preserve. Generate a SQUARE transparent RGBA sprite sheet of EXACTLY 36 distinct consecutive frames, SIX columns and SIX rows. This is a strict grid of 6x6=36, not 7x4 or any other arrangement. Prefer square 3072x3072. Reference is the exact blue-haired chibi whale maid identity. Every cell must contain a complete full-body character, at identical small size and feet baseline, with transparent gaps between cells. No labels, grid lines, colored backing or shadows. Preserve face, blue eyes, indigo/blue long hair and whale fin locks, small blue gold-heart bows, white maid headband, curled antenna, navy white gold-trim dress, whale apron emblem and shoes. Anime crisp cel-shaded style faithful to reference. Keep face/head/body size, costume detail and pose consistent. Animate a gentle listening idle cycle: tiny continuous deformation of antenna and long hair tips, gradually drifting left in frames 1-9, returning center 10-18, drifting right 19-27, returning center 28-36. Natural smooth blink in frames 10-16: open, slightly lowered, half closed, almost closed, closed, partly open, open. All other frames have relaxed open eyes and same tiny smile. Each of the 36 poses changes by a small amount from the previous, primarily the antenna and hair-tip curvature. Keep body and shoes stationary. Frame 36 almost matches frame 1. Do not rotate or translate the whole character, do not change costume or perspective. PRIORITY: exactly 6 rows and 6 columns, all 36 cells filled with one complete character. Background must be truly alpha transparent everywhere outside the character, no checkerboard painted in, no glowing background, no vignette, no watermark.
```

## 初版实现（历史）

- `.fm-art` 去掉底色、圆角和拉伸背景，角色直接露出当前卡片背景，保持冷灰/azure 界面。
- 内置 `image_gen` 参考项目原有 `src/ui/assets/whale-idle.png` 生成六姿势透明图集，原始图集保存在 `docs/art/whale-motion-v1.png`；原有三张状态素材保留。
- `scripts/build-whale-animation.py` 使用 Pillow 做等格裁切、可见边界对齐、共用调色板和 GIF 合成，不绘制替代动作。输出 `whale-loop-still.png` 和 `whale-listening-loop.gif`。
- GIF 是 256×320、10 帧、3.62 秒无限循环，六个实际姿势包含睁眼/半闭/闭眼及发梢、呆毛变化。统一脚底基线与调色板，透明索引 255、disposal 2 清除前帧。
- 主面板仅实际播放且动态效果“完整”时使用 GIF；暂停/中断/轻量/关闭时显示静态 PNG，准备状态保留原 DJ 素材。`picture/source` 响应系统 `prefers-reduced-motion`，避免仅禁用 CSS 却让 GIF 继续显示。
- 生产静态资源与独立预览均新增固定 PNG/GIF 白名单；MIME 按格式区分，维持 GET/HEAD 和卸载清理。

## 验证

- 23 项资源路由、DSH 客户端、展示状态相关测试通过；113 模块检查、bundle 一致性、构建/debug smoke 通过。
- 独立浏览器浅色/深色背景均无矩形色块；播放时 `currentSrc` 为 GIF，轻量/关闭和暂停为静态 PNG；390px 无横向溢出，picture 与角色列同宽；浏览器错误日志为空。
- 生成文件确认为 RGBA PNG 和透明 GIF89a；GIF 实际帧数、尺寸、循环时长由合成脚本读回校验。GIF 的透明边缘使用一位 alpha；静态 PNG 保留半透明边缘。
- 本轮仅隔离预览验收，没有退出/重启当前 DSH。新增后端资源路由需宿主重载后生效，真实 DSH 内显示继续保留未验。

## 生成提示词（内置工具，非 CLI）

```text
Use case: identity-preserve. Asset type: production animation sprite sheet for the FishFM music player, to be cropped into six frames and assembled into a transparent looping GIF. Input image 1 is the exact character reference. Generate ONE transparent sprite sheet, exactly 3 columns by 2 rows, six equal square cells, no grid lines, no labels, no background. Each cell contains the SAME full-body blue-haired chibi whale maid at identical scale, camera, proportions and ground position, centered with generous clear margins. Preserve her original face, blue eyes, long indigo-to-blue hair, small whale-fin side locks, blue bows with gold hearts, white frilled maid headband, curled hair antenna, navy-and-white dress with gold embroidery, white apron with small blue whale emblem, navy shoes. No headphones or added objects. Six consecutive subtle animation keyframes in reading order: 1 relaxed open eyes neutral; 2 slight eyelid lowering and tiny hair sway left; 3 both eyes gently closed in natural blink, hair near neutral; 4 reopening eyes and tiny hair sway right; 5 open eyes and gentle happy smile, antenna and hair tips settling; 6 return to almost identical neutral pose as frame 1. Movement must come from real eyelid shapes, antenna and hair-tip deformation, not whole-image rotation or translation. Keep feet, body, head size, outline, costume and drawing style stable across all cells. Crisp anime linework, soft cel shading matching reference, high detail at small UI scale. Entire background truly alpha transparent, including cell margins. No floor shadows, text, watermark, frame borders, panels or colored rectangles.
```

工具参数 `transparent_background=true`。生成输出留在 Codex 原始目录，项目使用其副本；没有引入第三方角色图或运行时 Pillow 依赖。复现合成：安装有 Pillow 的 Python 执行 `python scripts/build-whale-animation.py`，再 `npm run build:client`。
