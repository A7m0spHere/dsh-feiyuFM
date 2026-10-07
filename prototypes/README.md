# 隔离 UI 预览

`fishfm-ui-preview.html` 加载实际生成的 DSH 客户端，以模拟 RPC、歌曲和统计展示主面板、设置页与悬浮条；没有另一套生产前端，不访问账号或播放音频。

从根目录运行：

```sh
npm run preview:ui -- --react-root "C:/path/to/existing/node_modules" --port 4179
```

已有依赖需提供 React 18 与 react-dom 的 UMD 开发构建。主题、窄窗口、模拟操作和动效演示只用于界面验证，不当作生产账号、真实模型或音频证据。更多维护说明见 [贡献指南](../CONTRIBUTING.md) 与 [脚本索引](../scripts/README.md)。

## 素材来源

自有三张透明 PNG 由本项目此前使用 Codex ImageGen 生成。2026-10-07 整理时核对 SHA-256，原型副本与正式文件完全相同；删除原型副本，统一由生产资源路由读取 `src/ui/assets/`。

| 唯一维护文件 | 原始生成输出 | 用途 |
|---|---|---|
| [whale-idle.png](../src/ui/assets/whale-idle.png) | `exec-92d3fe0f-e92d-4cee-9061-fe306fabfb2a.png` | 待命 / 暂停 |
| [whale-listening.png](../src/ui/assets/whale-listening.png) | `exec-2dc4fe6d-b57d-4c5a-bf74-7c22c77c9c1f.png` | 听歌 |
| [whale-dj.png](../src/ui/assets/whale-dj.png) | `exec-fbd1d4cf-a644-4c8d-8e02-95cbd1dcda4d.png` | 选歌 / DJ |

锅盖 GIF、静态图与六张 doll PNG 同样来自当前生产资源路由，是否运行遵循播放、本机开关、动态偏好与系统减少动态设置。来源、许可和提取 hash 见 [第三方声明](../THIRD_PARTY_NOTICES.md)、[U10](../docs/spikes/U10-user-gif-cutout.md)、[U12](../docs/spikes/U12-playback-dolls.md)。
