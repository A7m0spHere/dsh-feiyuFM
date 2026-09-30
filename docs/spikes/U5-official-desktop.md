# U5 官方 DSH 桌面版适配

- 日期：2026-09-30，Windows，本机 `D:/dsh/DeepSeek Harness.exe`，官方桌面版 `0.2.0-rc.2`。
- 状态：真实 desktop profile 安装、启用、设置保存/恢复、停用清理、主面板与设置窗口、悬浮条基础鼠标交互已验证；音乐账号、平台音频和完整 A07/A08 未通过。
- 安装：应用内「插件 → 添加插件」输入仓库绝对目录，安装后「立即启用」。Plugin Manager 写入 `link:D:/AI项目/dsh-音乐` 和 bundle 声明，未手写 desktop profile 文件。
- 数据库：`C:/Users/86137/.dsh/fishfm/music.sqlite`，schema v3，0 首歌曲；独立于 PHL“2”的数据库和凭据。

## 现场问题与修复

| 问题 | 现场依据 | 修复 |
|---|---|---|
| 数据默认丢失 | 初次 Core 命令行是 `--db :memory:`，Host 没有导出 `DSH_HOME` | 按官方 `dsh-home-paths` 约定选择有效 `DSH_HOME`，未设置时 `~/.dsh`；支持 tilde 和空白变量；显式内存配置仍可用于测试 |
| 状态 RPC 返回 404 | 页面显示 `/api/fishfm/state: HTTP 404`；rc.2 只允许一个共享 Gateway interceptor | 用 `connection.fetch.register` 的六个精确 POST 路由与 Gateway 共存，继续经过宿主认证与原 Core；没有 Fetch registry 的旧宿主保留 interceptor 路径 |
| 悬浮条未显示 | DevTools 的 `shell.overlay` 条目报告 `TypeError: ... is not a function` | root hook 改为 `usePanelInfo(info => info.activePanelId)` |
| 拖动吸边错误 | 初次拖动跑到右上角；slot 包装层无尺寸 | 拖动、方向键和缩放读取真实 `[data-shell-overlay]` 边界，保留旧布局直接父元素回退 |
| 设置窗口文字挤压 | 宽桌面中的设置面板内容约 460px，原 media query 仍排两列 | 根据 FishFM 容器宽度应用 760/440 响应布局；空曲目快捷按钮增加禁用样式 |

接口依据为安装包 `resources/app.asar/dsh/node_modules/@deepseek-ai/` 内 `dsh-client-connection`、`dsh-client-ui-layout`、`dsh-home-paths` 和 `dsh-desktop-host` 的 rc.2 实现。只读取契约，没有复制实现或安装依赖。桌面 Host 缓存后端模块，本轮需正常退出并重新启动应用才能应用后端修复；仅停用/启用不更新缓存。客户端文件本轮可热加载。

## 真实验证

1. 侧栏「肥鱼电台」和原创状态图片正常显示；修复后状态 RPC 返回正常，网易云为「未登录」和扫码入口，QQ 为「接口尚未接入」。
2. 主面板关闭「电脑输出声音」显示保存回执；只读 SQLite 确认 `core_state.settings.humanPlayback=false`、`paused=true`。
3. 停用前 Core pid `59112`、宿主 `49732`。通过 Plugin Manager 停用后 Core 消失、宿主保留，侧栏和悬浮条移除；重新启用得到 Core `53548`，仍用持久化数据库，设置与暂停恢复。
4. 快捷抽屉可打开、Escape 收起，空曲目播放/下一首禁用；三点菜单显示模式、开关、设置与隐藏。隐藏后 Core 保留，从主面板重新显示成功。
5. 修复后鼠标从右侧拖到左侧，状态条在左侧吸附、纵向位置保持可见。停用/启用后显示偏好和左侧位置恢复。
6. 「账号菜单 → 设置 → 肥鱼电台」读回同一静音设置。容器布局修复后标题、当前播放、偏好卡正常显示。结束时恢复原声音开关 true；仍暂停、0 首曲目。

回归覆盖默认数据库、Gateway 共存和卸载、RPC 信封校验、root selector、面板切换及零尺寸 slot 包装层。全量离线测试在本机 Node 24.14.0 与官方桌面 Electron-as-node 24.18.1 均为 227/227；最终修改在桌面运行时通过 68 模块检查、构建和调试冒烟。验收证据审计 10/10、0 失效链接。容器布局与拖动修复经过现场视觉检查。

## 剩余范围

网易云有效扫码、导入和真实声音；QQ；真实工具/斜杠命令和多 Session；深色主题、窄窗口和完整键盘操作；两小时请求计数与真实故障。关闭面板/隐藏仅证明 Core 进程保留，本轮没有播放中的歌曲来验证音频连续性。

下一步在本机官方桌面版的「肥鱼电台 → 扫码登录」由用户手动确认，再推进真实音乐闭环；无需启动 PHL。
