# U3：DSH 主界面音乐设置

日期：2026-09-29。宿主：PHL “2”实例 `2-gpf9`，DSH `0.2.0-rc.1` Web profile。本地插件仍链接到当前仓库。

## 交付与操作

在 PHL 启动“2”实例并刷新 DSH 页面，侧栏“肥鱼电台”打开主面板；“设置 → 肥鱼电台”提供同一组设置。面板支持自主听歌、声音输出、探索、探索率、四种模式、暂停/继续/下一首、今天停止和双平台状态。

开关与模式即时提交，探索率点击保存后提交。日常/专注/静听是开始听歌的快捷操作；其他设置不会解除暂停。无当前曲目时“继续播放”禁用；平台尚未配置时如实显示，不伪造登录或播放能力。面板关闭不结束 Core；卸载插件仍由原有生命周期停止 Core。

## 接口依据

读取本机官方 `0.2.0-rc.1` 安装包的类型声明与调用示例后实现：

- `dsh-client-modules`：`dsh.client`、`./client` 与 `window.__ModuleLoader__.load`。
- `dsh-client-ui-sidebar`：`sidebar.panellist`；`dsh-client-ui-layout`：`main` keyed slot 与 `layout.selectPanel`。
- `dsh-client-ui-settings`：`settings.section`，关闭使用 owner 的 `close`。
- `dsh-client-connection`：宿主 `rpc.intercept`，浏览器 `rpc.call`，返回 `{ok,value}` / `{ok:false,error}`。

实现为本仓库原创，没有复制官方组件或 CSS。React 使用 DSH 浏览器已有的共享模块，不捆绑第二份 React。官方包来源为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，所查包版本 `0.2.0-rc.1`、声明许可 MIT；只参考接口，不引入代码文件或美术素材。

## 验证证据

完整回归：`npm run check` 检查 66 个模块，`npm test` 212/212 通过。

- `test/dsh-settings.test.mjs`：真实独立 Core 进程，设置读写、跨重启持久化与暂停、非法输入及任意命令拒绝、卸载移除 RPC。
- `test/dsh-client.test.mjs`：模块注册的三处插槽；控件发送正确命令并显示回执；旧读取结果不能覆盖保存；断连后控件禁用且可重试；面板卸载停止轮询；设置窗口关闭回调。组件使用轻量 React 测试替身，**不是浏览器视觉测试**。
- 真实“2”实例：HTTP 页面 200，boot graph 包含 FishFM、依赖与客户端地址；该地址下发 UI bundle 200，包含主面板及侧栏注册。
- 真实认证 RPC：无 cookie 请求 401；携带有效 cookie 但错误 Origin 请求 403；合法状态读取成功；探索率改为临时值后回读一致，随后恢复原值；超范围输入被拒绝。测试没有登录音乐平台、启动音乐或请求模型。

## 限制

浏览器工具访问 `127.0.0.1:3080` 与 `localhost:3080` 均返回 `net::ERR_BLOCKED_BY_CLIENT`，未完成真实浏览器截图、点击、深浅主题与窄屏验收。不能把页面下发/API 成功称为视觉验收通过。

网易云面板扫码登录随后在 [U4 快捷登录](U4-quick-login.md) 接入；独立悬浮窗/托盘未实现；新版 DSH 全部工具与真实平台播放的验收不由本轮替代。A07 仍未完全通过。
