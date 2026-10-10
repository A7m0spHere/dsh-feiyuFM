# 文生图入门工作流

2026-10-10：已按用户提供的 A6API 地址和凭据接入 `gpt-image-2.5`。云端生成使用 API，本地保留正常的图片尺寸调整和保存节点；标准采样学习画布单独保留。没有下载本地模型。

## 打开方式

打开本地 ComfyUI：<http://127.0.0.1:8188>。将这里的 JSON 拖到画布，或使用菜单中的 Open / 打开。也已复制到本地 `ComfyUI/user/default/workflows/`，可在工作流侧栏找到。

| 文件 | 学习目标 | 当前状态 |
| --- | --- | --- |
| `01-云端文生图-Image2.5.json` | 文本 → A6API `gpt-image-2.5` → 本地调整尺寸 → 保存图片 | API 节点与连线已接好，本机凭据已配置 |
| `02-标准节点学习-文生图.json` | Checkpoint、正负提示词、潜空间、采样、VAE 解码、保存的完整结构 | 执行后端可用的 SD1.5 普通 Checkpoint |

## 为什么不能只把 Checkpoint 换成普通 API

Checkpoint Loader 输出的是 `MODEL`、`CLIP`、`VAE`，分别用于采样、文字编码和解码。普通图像生成 API 通常返回成品图片、图片 URL 或 base64，不能直接当作这些输出。

- 希望学习并保留完整标准节点：将第二张画布导入云端 ComfyUI，由云端执行全部生成节点，选择云端已有模型。本地不需要下载模型；云端连接、认证和取图尚待配置。
- 希望使用普通图像 API：使用第一张画布。文本 `STRING` 已接到 A6API 节点的提示词输入；该节点将返回的 URL / base64 转换为 ComfyUI 的 `IMAGE`，接到 ImageScale 的 `image`。

第一张画布现在可以发起真实云端生成，替换了之前的预留说明框。每次点击运行会请求一张图，按服务商计费；不自动重试，不回退到其他模型。第二张仍未选择 Checkpoint，不能直接出图。

## 运行云端画布

1. 在侧栏打开 `01-云端文生图-Image2.5`。
2. 在左侧提示词中描述主体、场景、光线和风格。
3. 中间节点模型保持 `gpt-image-2.5`，首次生成尺寸为 `1024x1024`。
4. 点击运行，等待右侧 Save Image 显示图片；结果保存在 `ComfyUI/output/learning/`。

外置节点源码、安装方式和凭据位置见 [A6API 节点说明](../integrations/a6api/README.md)。源码使用 ComfyUI 已有依赖；本机已安装，其他机器需要同步该节点并自行配置凭据。密钥未放入工作流、说明或版本库。

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

第一张画布的 ImageScale 使用宽 1024、高 0 保持比例，不裁切。它调整的是生成后的图片尺寸，不控制云端生成分辨率，也不是 AI 超分辨率。本次 API 节点仅提交模型、提示词、尺寸和一张图片的数量；没有接入负向提示词、seed、steps 或 CFG。

API Key 应由服务商支持的凭据机制管理，不要写进可分享的 JSON、Note 或版本库。

## 核对依据

- 本地运行实例：ComfyUI `0.39.0`；节点名称、输入、输出已与 `http://127.0.0.1:8188/object_info` 核对，Checkpoint 列表为空；A6API 的 `/v1/models` 确认返回 `gpt-image-2.5`。
- [ComfyUI 官方文生图教程](https://docs.comfy.org/zh/tutorials/basic/text-to-image)。
- [ComfyUI 官方 Partner Nodes 说明](https://docs.comfy.org/zh/tutorials/partner-nodes/overview)。

两张 JSON 已通过节点 schema、端口类型、双向连线引用和预期留空项检查，安装副本与源文件逐字节一致；已在本地 ComfyUI 侧栏逐一打开，中文说明与节点均成功显示。

自编 A6API 节点通过 6 项离线测试：base64 解码及单张请求、URL 下载不携带密钥、HTTP 失败无重试和响应泄露、超时无重试、缺失凭据不发请求、空图片响应不伪造输出。运行命令：`PYTHONPATH=ComfyUI ComfyUI/.venv/bin/python -m unittest discover -s integrations/a6api -p 'test_*.py' -v`。

首次真实验收：只提交了一次 `gpt-image-2.5` / `1024x1024` / `n=1` 请求，ComfyUI 历史记录状态为 `success`，完整工作流耗时约 35.6 秒。输出 `ComfyUI/output/learning/cloud-txt2img_00001_.png`，PNG 尺寸 1024×1024，内容为橘猫、窗台、绿植和清晨阳光的水彩图；已打开检查实际图像，并在 ComfyUI 媒体资产中核对预览。PNG 内嵌模型与工作流均正确，不包含凭据；SHA-256 为 `d512bbb2f1f610869211da4613bffd1f6c9bbbe93db582be303f2085f7579a54`。运行图片留在忽略目录，不提交。

本次只验证了方形单张生成，其他尺寸、长期稳定性、具体费用和计费账单未核对；标准 Checkpoint 工作流仍未做本地出图验收。接口返回的模型标识是 `gpt-image-2.5`，本次验收不独立证明中转服务背后的上游模型来源。

工作流、节点与中文说明为本次编写，未复制第三方工作流或图片素材。
