# N24：后台隔离 DSH 工程验收

2026-10-21。用户要求后台完成，不占用前台电脑。当前进度只维护在 [PROJECT_PLAN](../PROJECT_PLAN.md)；本报告记录实测步骤、结果与边界。结构化结果见 [N24 JSON](assets/N24-dsh-background-results.json)。

## 环境与隔离

Windows、驱动 Node 24.14.0、官方 DSH 0.2.1-rc.2 内置 Node 24.21.0。通过官方 Web 模板创建全新 `DSH_HOME`，由官方 CLI `plugin --profile fishfm-acceptance add <repo> --offline` 安装源码链接；`--no-open` 启动，所有子进程使用 `windowsHide`，没有打开浏览器或原生 Desktop 窗口。

模型沿用已有 `czwb/deepseek-v4.1-flash` 路线，只将该路线的 credential ref 写入隔离 home，不复制其他账号记录；前后校验日常 profile patch 和凭据文件 hash 一致。没有打开日常音乐数据库、重载日常插件或操作平台账号。测试媒体为本机生成的零振幅 PCM，走真实 WPF 和生产 Core，不发声。Provider 和歌曲元数据为明确的本地替身；受控曲库用兼容 `legacy` 模式并关闭 Discovery，不表示默认 `filtered` 的平台候选与补批已验。

## 操作与结果

| 检查 | 结果与证据 |
|---|---|
| 安装／启用／RPC | 官方 CLI 离线安装、插件激活、Core ready 与认证 HTTP RPC 通过。启动 token 先换取 Cookie，再访问 `/api/fishfm/*` |
| 真实 Session 身份 | 通过宿主 SessionController 创建两个实际 Agent；事件携带的稳定身份字段为 `session.id`，两个 ID 不同，不再靠候选字段猜测 |
| 真实并发／不抢播 | 两个 Agent 的实际 LLM 请求时间重叠，均有最终文本和 `stop`；期间原播放实例保持不变 |
| 暂停优先 | 用户暂停后向实际会话发送下一轮固定测试请求；真实 `turn/start`、`turn/end` 后仍暂停 |
| 逐曲零请求 | 下一首、暂停、恢复及无浏览器客户端播放期间，额外 LLM 服务请求为 0；这些操作不占音乐模型账本 |
| 启停上下文对照 | 相同固定任务：启用时 3 项静态 FishFM 工具，序列化 1054 bytes；停用后新会话 0 项。启用期间工具指纹不随曲目改变，所采系统／开发者消息未出现动态音乐状态标记；不将字节数当 token |
| 显式音乐调用归因 | 将隔离测试单次输出上限设为 2048 后，手动总结成功：新增 1 次模型服务调用、1 条 completed 音乐账本，usage 为 input 154／output 159；没有改日常设置 |
| 有效收听／Session 成长 | 16 秒媒体得到 9418 ms 实际 agent 有效进度，一条新增成长；静音、短会话权重和跳过权重后 delta 为 0.0045，Session ID 与宿主匹配 |
| 瞬间换曲／失败 | 瞬间切歌未达阈值不成长；真实 WPF 打开不存在媒体失败，不新增正向成长 |
| 停用清理 | 通过真实 Loader entry 更新停用，Core、WPF PowerShell 及其控制台子进程均退出，磁盘 Core／Adapter 证据都标记 closed |
| 重新启用 | 新 Core PID，与旧进程不同；暂停和已结算成长保留，成长任务数不变 |
| 宿主收尾 | 再次停用插件、确认 Core 结束后，由隔离探针退出 Web 进程，exit code 0；这不是原生 Desktop 的正常关窗验收 |

最终流程 **21/21 通过**。最终成功流程共 5 次真实 LLM 服务请求：4 次固定 Agent 测试任务、1 次显式音乐总结。校验器适配／排障期间另有 7 次，共 12 次；其中一次默认 256 输出上限的总结返回 `model_output_limit`，失败与实际 usage 已入账，后续显式提高隔离上限才成功。供应商内部 HTTP 重试与货币金额未采集，保持 unknown。

## 修复与回归

确认运行证据的正常关闭缺陷：原 `close()` 先 `sample()/flush()`，再把内存 `closed` 置 true，因此磁盘仍为 false。现将关闭标记纳入同一次原子写入；失败或被新实例拒绝时撤回内存标记，保留既有写入健康记录。新增回归检查最终事件、磁盘 closed 与即时 stale，原写失败／实例接管回归保持通过。

另修正 `verify:lifecycle` 仍检查 schema 3 的旧断言，与当前 schema 11 对齐；`check` 增加 `.cjs` 语法检查，覆盖验收初始化脚本。

| 检查 | 结果 |
|---|---|
| 运行证据专项 | 14/14 通过 |
| 全量回归 | 539 项：536 通过、0 失败、3 项真实媒体跳过；`FISHFM_TEST_REAL_AUDIO=0`，并发限制为 2。本轮真实 WPF 在上述宿主流程中另验 |
| 独立生命周期脚本 | 14/14 通过；隔离假平台，不等同真实登录或 DSH 安装 |
| 不提供模型 home 的验收入口 | 14/14 本地检查通过；真实模型及上下文对照明确记未执行 |
| 构建／包／引用 | 160 模块检查、构建/debug smoke、npm 包白名单通过；104 份文档零坏链接、10/10 引用齐全 |

## 复现入口

从仓库根目录执行，输出目录必须不存在。以下路径为本轮机器的示例；模型 home 参数只用于显式复用该路线的配置和 credential ref。

```powershell
node scripts/verify-dsh-integration.mjs `
  --runtime-node 'D:/dsh/DeepSeek Harness.exe' `
  --runtime-root 'D:/dsh/resources/app.asar/dsh' `
  --out '.tmp/dsh-acceptance-new-run' `
  --model-home 'C:/Users/86137/.dsh'
```

省略 `--model-home` 时只做本地宿主／播放／生命周期检查，真实模型与上下文对照记未执行。脚本不属于 `npm test`，不会在 CI 自动读取账号配置或调用真实模型。探针只挂载在此次隔离 profile，不进入 npm 包。

## 未执行与验收边界

- 网易云真实账号、平台音频、默认 filtered 的完整补批／自动筛选、平台权限故障：本轮未执行，不能由本地媒体和替身 Provider 代替。
- 原生 Desktop 正常退出／重开、前台窗口主题／窄屏／键盘、跨设备与真人听音：本轮未执行；macOS 在此 Windows 环境不适用，仍待真机。
- 多 Session 本轮覆盖真实并发与身份、短会话成长；长期差异、各模式／到期约束与平台音频组合仍未全覆盖。
- 不恢复已取消的两小时连续观察，不将本轮 21 项通过提升为 A01–A10 全部通过，也不将源码链接安装视为发行 tarball 验收。

凭据、生成媒体、完整宿主日志和运行数据库不提交。对外只保留脱敏 JSON 与本报告。
