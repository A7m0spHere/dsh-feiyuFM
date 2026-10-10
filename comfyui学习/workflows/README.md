# 文生图入门工作流

2026-10-10：按要求保留云端 API 位置，服务商、接口、模型和认证均未配置。没有下载模型或调用付费 API。两张画布可导入学习，当前都不具备出图条件。

## 打开方式

打开本地 ComfyUI：<http://127.0.0.1:8188>。将这里的 JSON 拖到画布，或使用菜单中的 Open / 打开。也已复制到本地 `ComfyUI/user/default/workflows/`，可在工作流侧栏找到。

| 文件 | 学习目标 | 当前缺少什么 |
| --- | --- | --- |
| `01-云端API预留-文生图.json` | 文本 → 云端生成 → 本地调整尺寸 → 保存图片 | 真实 API 节点及其两侧连线；中间 Note 仅用于说明 |
| `02-标准节点学习-文生图.json` | Checkpoint、正负提示词、潜空间、采样、VAE 解码、保存的完整结构 | 执行后端可用的 SD1.5 普通 Checkpoint |

## 为什么不能只把 Checkpoint 换成普通 API

Checkpoint Loader 输出的是 `MODEL`、`CLIP`、`VAE`，分别用于采样、文字编码和解码。普通图像生成 API 通常返回成品图片、图片 URL 或 base64，不能直接当作这些输出。

- 希望学习并保留完整标准节点：将第二张画布导入云端 ComfyUI，由云端执行全部生成节点，选择云端已有模型。本地不需要下载模型；云端连接、认证和取图尚待配置。
- 希望使用普通图像 API：使用第一张画布，后续根据服务商的真实接口选择或实现 API 节点。文本 `STRING` 接到 API 提示词输入；API 输出的 `IMAGE` 接到 ImageScale 的 `image`。URL / base64 必须先由适配节点转换为 ComfyUI 的 `IMAGE`。

第一张画布没有虚构 API 节点，也没有用本地图像假装云端生成。当前点击运行会报告 ImageScale 缺少 `image`，第二张会报告 Checkpoint 不可用；这是明确保留的接入缺口。无需通过安装随机插件消除这些提示。

## 第一课：读懂第二张画布

1. Checkpoint 提供模型、文字编码器和 VAE。
2. 两个 CLIP Text Encode 将“希望出现”和“希望避免”的文字变成生成条件。
3. Empty Latent Image 设置宽、高和张数，输出潜空间占位；KSampler 根据 seed 初始化采样噪声。
4. KSampler 结合模型、条件和噪声进行采样，结果仍是潜空间数据。
5. VAE Decode 把潜空间转换成可见图片。
6. Save Image 显示预览，并保存到执行后端的 `output/learning/`。

画布沿用标准端口类型，并用中文标题和说明标出每一步；不依赖第三方自定义节点。

## 模型就绪后再做的练习

第二张画布的学习起点是 SD1.5 普通模型：512×512、1 张、seed 42 / fixed、20 steps、CFG 7、euler / normal、denoise 1。这不是 SDXL、FLUX、蒸馏模型等的通用参数。

先固定 seed，每次只改一个变量：橘猫改白猫 → 水彩改摄影 → 更换 seed → 比较 20 / 30 steps。固定 seed 便于同一环境比较，不保证跨硬件、模型或软件版本一致。

第一张画布的 ImageScale 使用宽 1024、高 0 保持比例，不裁切。它调整的是生成后的图片尺寸，不控制云端生成分辨率，也不是 AI 超分辨率。负向提示词、seed、steps、CFG 等是否可用须以选定 API 为准。

API Key 应由服务商支持的凭据机制管理，不要写进可分享的 JSON、Note 或版本库。

## 核对依据

- 本地运行实例：ComfyUI `0.39.0`；节点名称、输入、输出已与 `http://127.0.0.1:8188/object_info` 核对，Checkpoint 列表为空。
- [ComfyUI 官方文生图教程](https://docs.comfy.org/zh/tutorials/basic/text-to-image)。
- [ComfyUI 官方 Partner Nodes 说明](https://docs.comfy.org/zh/tutorials/partner-nodes/overview)。

两张 JSON 已通过节点 schema、端口类型、双向连线引用和预期留空项检查，安装副本与源文件逐字节一致；已在本地 ComfyUI 侧栏逐一打开，中文说明与节点均成功显示。

工作流与中文说明为本次编写，未复制第三方工作流或图片素材。结构检查和界面导入不等于真实出图验收；API 调用、云端采样和图片质量仍未验证。
