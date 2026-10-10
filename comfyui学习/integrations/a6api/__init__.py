import base64
import io
import json
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
import numpy as np
from PIL import Image, ImageOps
import torch

import folder_paths


class A6APITextToImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "prompt": ("STRING", {"multiline": True}),
            "model": (["gpt-image-2.5"],),
            "size": (["1024x1024", "1536x1024", "1024x1536"],),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "generate"
    CATEGORY = "learning/cloud"
    DESCRIPTION = "通过 A6API 生成一张图片；每次运行会调用付费接口。密钥从本机配置读取，不进入工作流。"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    async def generate(self, prompt, model, size):
        credential_path = Path(folder_paths.get_user_directory()) / "default" / "a6api.secret.json"
        try:
            with credential_path.open() as file:
                key = json.load(file).get("api_key", "")
        except FileNotFoundError:
            raise RuntimeError("缺少本机 A6API 凭据，请按 integrations/a6api/README.md 配置。") from None
        if not isinstance(key, str) or not key.strip():
            raise RuntimeError("本机 A6API 凭据为空。")
        if model != "gpt-image-2.5":
            raise ValueError("当前学习节点仅接入 gpt-image-2.5。")

        timeout = aiohttp.ClientTimeout(total=300, sock_connect=30)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    "https://api.a6api.com/v1/images/generations",
                    headers={"Authorization": "Bearer " + key},
                    json={"model": model, "prompt": prompt, "n": 1, "size": size},
                    allow_redirects=False,
                ) as response:
                    if response.status != 200:
                        raise RuntimeError(f"A6API 生成失败，HTTP {response.status}。请核对密钥、模型权限、余额或服务状态；未自动重试。")
                    result = await response.json()

                data = result.get("data")
                if not isinstance(data, list) or not data:
                    raise RuntimeError("A6API 未返回图片 data；未自动重试。")
                item = data[0]
                if item.get("b64_json"):
                    image_bytes = base64.b64decode(item["b64_json"], validate=True)
                elif item.get("url"):
                    image_url = item["url"]
                    if urlsplit(image_url).scheme != "https":
                        raise RuntimeError("A6API 返回的图片地址不是 HTTPS。")
                    # 下载签名图片时不携带 API 密钥。
                    async with session.get(image_url) as response:
                        if response.status != 200:
                            raise RuntimeError(f"云端图片下载失败，HTTP {response.status}；未重新生成。")
                        image_bytes = await response.read()
                else:
                    raise RuntimeError("A6API 图片缺少 b64_json 或 url；未自动重试。")
        except (aiohttp.ClientError, TimeoutError):
            raise RuntimeError("A6API 请求超时或网络异常；未自动重试，请先核对服务端是否已经生成或扣费。") from None

        with Image.open(io.BytesIO(image_bytes)) as image:
            pixels = np.array(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.float32) / 255.0
        return (torch.from_numpy(pixels).unsqueeze(0),)


NODE_CLASS_MAPPINGS = {"A6APITextToImage": A6APITextToImage}
NODE_DISPLAY_NAME_MAPPINGS = {"A6APITextToImage": "A6API 云端文生图 · Image 2.5"}
