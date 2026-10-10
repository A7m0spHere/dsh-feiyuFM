# A6API 文生图节点

本项目自编的外置 ComfyUI 节点，不修改 ComfyUI 核心，不新增依赖。通过 `POST https://api.a6api.com/v1/images/generations` 调用用户指定的 `gpt-image-2.5`，每次请求一张图，无自动重试、无其他模型回退。模型 ID 已通过用户凭据访问 `/v1/models` 确认。

## 本机安装

本机已将 `ComfyUI/custom_nodes/a6api` 链接到此目录。其他机器需要将此目录复制或链接到其 ComfyUI 的 `custom_nodes/a6api`，然后重启 ComfyUI。

在执行后端的 `user/default/a6api.secret.json` 配置 `api_key` 字段，文件权限设为仅用户可读写（`600`）。本机凭据已配置；文件位于 ComfyUI 忽略的用户数据目录，不提交。不要把密钥填进工作流、Note、日志或聊天。

节点仅提供提示词、模型名称和生成尺寸。未暴露未经此 API 验证的 seed、steps、CFG 或负向提示词。每次点击运行都会发起一次云端生成，按服务商计费；完全相同的提示词也会重新请求。

返回的 base64 图片或 HTTPS 图片 URL 会转换为正常 `IMAGE` 张量，供本地 ImageScale、SaveImage 等节点使用。图片 URL 下载不携带 API 认证头；认证生成请求禁止重定向。错误不会原样输出服务端响应或密钥。遇到超时请先核对服务端记录，再手动决定是否重新运行，避免重复扣费。

首次真实调用已通过：单张 `1024x1024` 图片成功生成、转换、保存和预览；详细证据见 [工作流说明](../../workflows/README.md)。其他尺寸未做真实调用验收。

标准 Checkpoint、CLIP、KSampler、VAE 学习画布仍单独保留；这些计算由云端图像 API 内部完成，不会在本地伪造执行。
