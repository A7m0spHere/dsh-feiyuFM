# U4：面板快捷扫码登录

日期：2026-09-29。目标实例：PHL “2”实例、DSH `0.2.0-rc.1` Web profile，bundle 仍以 `link:D:/AI项目/dsh-音乐` 指向当前工作区。此增量把网易云扫码入口加到现有“肥鱼电台”页；QQ QR 的 endpoint map 没有核实，面板明确将其标为未接入。

## 使用流程

在网易云音乐卡片点击 **扫码登录**，用网易云 App 扫码，并在手机端确认。面板每 2.5 秒自动查询状态，显示“等待扫码”“已扫码，请确认”“登录成功”或“二维码过期”。登录成功后点击 **导入我的音乐**。面板显示真实来源、新增首数、现有总数与来源降级原因。也可以退出本机账号后重新扫码。

二维码由项目服务端本地编码。只有已认证的 DSH 页面可以请求登录接口；密钥不以 API 字段返回 UI，二维码本身包含平台要求的扫码 URL。二维码 URL 被限制为 HTTPS `music.163.com`。会话材料保存在 `<DSH_HOME>/fishfm/credentials/netease.dpapi`（Windows CurrentUser DPAPI）；SQLite 只保留引用。Core 重启时从 DPAPI 取回会话并重新填充平台 transport。关闭或重开面板不会终止未完成扫码。

支持范围采用仓库已经实测的 NetEase endpoint profile。现有证据确认 `/api/login/qrcode/unikey` 的 key、`/api/login/qrcode/client/login` 新码返回 801 等待、过期返回 800。扫码后的 802/803 细节、cookie 完整响应和一次真实授权仍未验证；状态转换及 cookie 捕获不能称作真实账户验收。需要用真实账号扫描确认后台是否收到 cookie、DPAPI 文件能否被新 Core 进程解封，再进行搜索、导入和音频播放。

音乐导入使用现有 Provider 来源顺序 `recent → liked → playlist`。除已记录的少量探测外，这些需账号的歌曲列表响应仍未核实。UI会显示实际来源和错误，不保证首次导入立刻成功。

QQ 的类型适配器还保留在代码中，但没有可靠接口 map。根据项目规则，目前不显示 QQ 扫码入口；待 QR、cookie、搜索和资源解析接口得到证据后再连接同一路径。

## 改动边界

- DSH Browser 连到宿主已认证的 `/api` RPC；没有新增端口、模型工具或 LLM 请求。
- 登录与设置都复用 Core，不从界面单独保存曲目状态。
- 把原有 `qrcode@1.5.4` 提升为应用运行依赖，因 Core 需要生成 PNG Data URL；没有安装新包版本。包来自 `soldair/node-qrcode`，MIT；传递依赖仍记录在 `package-lock.json`，细节见 [DECISIONS 第 0 节](../DECISIONS.md)。
- 本机 `DSH_HOME` 是 Windows 路径时会启用持久化凭据与网易云适配器。内存库和非 Windows运行时不声称支持持久扫码登录。

## 未验证

本轮按用户“尝试接入”要求落下了交互与服务流程，但没有替用户扫码，也没有触发平台请求、运行测试或声称真实登录成功。网络状态码和需要账号的 endpoint 仍须在用户扫描后核对；然后才可判断登录闭环是否达成。浏览器工具仍无法打开本机 `127.0.0.1:3080`，因此这次没有录入面板视觉实测。
