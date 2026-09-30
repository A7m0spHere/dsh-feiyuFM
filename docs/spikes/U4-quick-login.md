# U4：网易云快捷登录、导入与 DSH 悬浮音乐条

本页为 2026-09-29 PHL 阶段记录。2026-10-01 本机官方桌面版已修复扫码并真实授权，最新流程与证据见 [U6](U6-qr-login-repair.md)。新授权先在内存校验 UID 再写凭据；QR 检测已统一使用 type 3 社区模块。

更新：2026-09-29。目标安装：PHL“2”实例，DSH `0.2.0-rc.1` Web profile，目标数据库为 `E:/PHL-DSH/instances/2-gpf9/dsh-home/fishfm/music.sqlite`。本增量将网易云账号/歌曲列表读取切换到固定版本社区 Node API，并将播放器控件接入 DSH `shell.overlay`；QQ 登录入口仍明确标记为未接入。

## 当前使用流程

在网易云音乐卡片点 **扫码登录**，用网易云 App 扫描并确认；状态每 2.5 秒轮询。确认后通过社区 `login_status` 读取 `profile.userId`。点击 **导入我的音乐** 后按 `近期记录 → 喜欢列表 → 用户歌单` 尝试；喜欢和歌单先取 ID 再用 `song_detail` 获取曲目元数据。面板显示实际来源、新增首数、累计数、各来源失败阶段及接口码。若会话失效，状态显示为“登录已过期”，可以重新扫码。

二维码仍由项目服务端本地编码，地址限制为 HTTPS `music.163.com`。会话材料只在 Core 内存交给 API；服务端返回的新 Cookie 合并后写入 Windows CurrentUser DPAPI。SQLite 只存凭据引用与账号 ID。社区 API 只在 Core 内调用，不启动 Express 服务。

## 社区 API 与失败处理

固定依赖 `@neteasecloudmusicapienhanced/api@4.40.1`，包清单标注 MIT。调用 `login_status`、`user_record`、`likelist`、`user_playlist`、`playlist_detail`、`song_detail`，WeAPI 加密在对应模块里完成。社区 API 有较大的依赖树（本轮 npm 增加 258 个包；完整锁文件记录在 `package-lock.json`），范围和许可见 [第三方声明](../../THIRD_PARTY_NOTICES.md)。

- 扫码确认后读取 `body.data.profile.userId` 并更新 `credential_references.account_id`。
- 旧账号没有 ID 时，导入前先调用 `login_status`；UID 不可用时不发送任何种子来源请求。
- `account:null` 且 `profile:null` 表示服务端当前看到的是游客态，Core 将凭据引用标记为 `expired`，不会把它误报成“已授权但 UID 缺失”。有效会话有 profile 但没有 UID 时，返回 `account_id_unavailable` 并停止导入。
- 来源尝试只传阶段、数量、HTTP/API 错误码与脱敏说明；Cookie、Token、签名和原始响应不会进入 SQLite、面板 RPC 或 Core JSON-lines 输出。

## PHL“2”实例验收结果

使用现有 DPAPI 凭据对目标数据库执行 `login_status`：HTTP 200、API code 200，但响应为 `account:null`、`profile:null`。因此无法从这份旧会话恢复 UID，也没有发出近期记录、喜欢列表或歌单请求。Core 随后把该凭据引用正确标记为 `expired`；数据库仍是 **0 个网易云导入批次、0 首网易云曲目**。DPAPI 文件未删除，用户重新扫码后可继续。

这次真实请求确认了“数据库显示 authorized 不代表网易云会话仍有效”的失败路径；尚未完成真实 UID 恢复和歌曲导入。PHL 管理器进程在本机存在，但本轮验收时 `127.0.0.1:3080` 拒绝连接，无法打开当前实例浏览器页做视觉/鼠标验收。需要先在 PHL 中启动“2”实例，再由用户在网易云 App 扫码确认；不自动化账号认证界面。

## DSH 悬浮音乐条

客户端在 DSH `shell.overlay` 槽位注册状态条，与主设置页共享同一个 Core controller。状态条显示曲名、艺人和播放状态；展开后可暂停/继续/下一首，三点菜单可切换模式、打开完整设置、隐藏挂件。支持本地记忆位置、方向键移动并吸附左右边缘、Esc/点击外部关闭；设置页可重新显示，打开 FishFM 主面板时自动收起。图片由项目已有原创鲸鱼娘插画提供，并通过三个只读 PNG 路由加载。

视觉只参考 DeepSeek 余额鲸鱼挂件的气泡和三点菜单；没有复制它的代码或素材。SwipeHandle 的下滑关闭逻辑适配自 `dsh-api-dashboard` v1.4.5 固定提交，MIT 声明及代码范围见 [第三方声明](../../THIRD_PARTY_NOTICES.md)。离线交互测试已覆盖 overlay 注册、Core 命令共享、菜单打开完整设置和过期状态回显；当前 PHL 实例 UI 的截图/鼠标操作尚未实测。

## 改动边界

- DSH 页面通过宿主认证 `/api` RPC；不新增监听端口、模型工具或 LLM 请求。
- UI 不保存曲目/播放状态；Core 仍是唯一状态所有者，播放仍由 Core 管理的服务负责。
- 不新增数据库迁移；旧账号引用缺少 `account_id` 时在线补齐。
- QQ 适配器代码保留，但没有 QR / Cookie / 搜索 / 解析的可靠接口证据，不显示伪登录按钮。
