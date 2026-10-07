# U16：挑歌冷却与请求反馈

2026-10-07。用户在“换一批”后看到 `summary_cooldown` 红色提示，要求参考类似开源项目改善体验。按钮没有读取冷却状态，请求先刷新平台候选，到模型预留时才被拒绝；普通限制与服务失败共用错误展示。

## 参考

| 项目与版本 | 查阅范围 | 借鉴的交互 |
|---|---|---|
| Navidrome，`52135913d4747c8f8ddcfd8e7004202b8f53b594`，GPL-3.0 | [LibraryScanButton.jsx](https://github.com/navidrome/navidrome/blob/52135913d4747c8f8ddcfd8e7004202b8f53b594/ui/src/library/LibraryScanButton.jsx)、[useScanElapsedTime.jsx](https://github.com/navidrome/navidrome/blob/52135913d4747c8f8ddcfd8e7004202b8f53b594/ui/src/layout/useScanElapsedTime.jsx) | 根据后台状态禁用重复操作，以服务端时间为锚更新时间展示，普通通知与失败分开 |
| Music Assistant frontend，`1e8c8c381171b7f1b9b61f037a69f2d548d61d7f`，Apache-2.0 | [ShowCard.vue](https://github.com/music-assistant/frontend/blob/1e8c8c381171b7f1b9b61f037a69f2d548d61d7f/src/components/ai-radio/ShowCard.vue)、[useShows.ts](https://github.com/music-assistant/frontend/blob/1e8c8c381171b7f1b9b61f037a69f2d548d61d7f/src/composables/ai-radio/useShows.ts) | 处理中、历史状态与失败分别展示，并发拒绝后重新读取服务端状态 |

只参考交互原则，没有复制代码、样式或素材，没有安装新依赖。倒计时结合 FishFM 自身门控实现，不声称上述项目都有推荐冷却倒计时。

## 改动

- 持久化账本提供冷却截止时间、后台任务和每日剩余次数。前端以服务端时间为锚更新倒计时，不从本次点击推测冷却。
- 冷却按钮显示 `mm:ss 后可换` 并禁用，到期恢复可用；到期本身不调用模型。找歌与模型挑歌使用不同状态文案。
- 冷却、任务占用、次数上限、预算不足和暂无候选显示普通说明；真实失败保留错误与重试入口，代码收入默认收起的“技术详情”。没有歌单时不声称保留了歌单。
- 手动挑歌在平台刷新前检查门控；模型预留事务仍最终复验。预留/启动使 UI 账本缓存失效，另一窗口能读取进行中的任务。
- 15 分钟冷却、每天 12 次、共享预算、未知用量计费、已知失败的有限重试、暂停与用户控制保留。已有歌曲仍可点播。

## 验证

- **104/104 相关测试通过，零跳过**：persona、模型歌单、推荐链路、设置 RPC、客户端与展示。新增五项回归覆盖跨客户端任务、缓存、刷新前门控、期限与日界线、失败/中断、计时字段传输、普通限制与真实失败区分。
- **54 个浏览器组合 ALL-PASS**：1280/390/320px × 浅深色 × 可换批/冷却/即将结束/找歌/挑歌/预算不足/次数用完/请求失败/并发冷却；无横向溢出，控制台零 error/warn。
- 服务端时钟快 5 分钟时仍显示约 15 分钟冷却；到期自动恢复按钮；失败期间点播和暂停可用，技术详情可键盘展开，设置席位也显示冷却。
- **127 模块、客户端 bundle、构建/debug smoke**通过。本轮未跑音频全量，N22 的 420 项保留为此前全量基线。

证据：[冷却截图](assets/U16-cooldown-light.png)、[深色失败截图](assets/U16-failure-dark.png)、[浏览器记录](assets/U16-ui-results.json)。页面歌曲、RPC 与模型输出均为模拟数据。复用已有 React 18 与 Playwright/Edge；运行 `npm run preview:ui -- --react-root D:/AI项目/dsh-phl/node_modules --port 4192`，工具栏“挑歌预览状态”可切换场景。

生产未重载，未发布 npm，未操作生产账号、音频或真实模型。现场验收与加载边界以 [开发路线](../PROJECT_PLAN.md) 为准。
