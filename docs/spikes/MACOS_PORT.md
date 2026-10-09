# macOS 源码移植

日期：2026-10-09。此记录描述当前 `main` 的 macOS 源码适配和本机集成边界；已发布 `0.1.0-beta.2` 仍只支持 Windows，不据此宣称 npm beta 支持 macOS。

## 本机环境

| 项目 | 检查结果 |
|---|---|
| 系统/架构 | macOS Darwin 27，arm64 |
| DSH | 官方桌面 `0.2.0-rc.2`，profile `desktop` |
| DSH Node | `24.18.1` Electron-as-node；当前桌面 profile 使用 bundled Node 24 |
| Swift | `/usr/bin/swiftc` 6.3.3 |

## 实现

- 保留 Windows WPF/命名管道和 DPAPI 路径；macOS 播放通过 Swift `AVPlayer` Helper 实现，使用协议 v1 和短路径 `/tmp/ffm-<pipe-name>.sock` 的 AF_UNIX socket。
- Helper 由插件附带的 Swift 源码按需编译，缓存至 `$DSH_HOME/fishfm/hosts`，目录及可执行文件权限为当前用户。Core PID 退出后 Helper 停止播放并清理 socket。
- macOS 网易云会话写入用户 Keychain generic-password 项，`WhenUnlockedThisDeviceOnly`；数据库只保留凭据引用。凭据内容经 stdin/stdout JSON 与 Helper 传递，不放在进程参数中。
- npm 平台声明、shrinkwrap 与包清单包含 `darwin` 和 Swift 源码。没有发布新 npm 版本。

## 当前验证

- `swiftc -swift-version 5 -parse-as-library -typecheck src/playback/host/fishfm-macos-host.swift`：通过。
- 完整编译命令 `/usr/bin/swiftc -swift-version 5 -parse-as-library -O src/playback/host/fishfm-macos-host.swift -o /tmp/fishfm-macos-host-check`：通过，退出码 0。
- 用 DSH Electron-as-node `24.18.1` 执行 `npm ci --ignore-scripts --no-audit --no-fund`：287 个依赖安装完成。
- DSH CLI 已把工作副本添加为 `desktop` profile 的本地 `link:` 依赖和 bundle；应用完整退出/重开后，主界面侧栏显示「肥鱼电台」，悬浮条显示「肥鱼电台 · 待命」。profile `node_modules/dsh-feiyufm-core` 指向此仓库。
- DSH Node 24 语法检查覆盖 131 个模块并通过。包清单验证通过：4877 个文件，压缩体积 35.13 MB，包含平台声明、Swift Helper 与运行依赖。
- 当前 Helper 已预编译到 `$DSH_HOME/fishfm/hosts/` 的源哈希缓存，目录和可执行文件权限均为 `700`。
- 真实网易云登录/Keychain 写读删、平台音频播放/暂停/曲终、Core/Helper 退出生命周期仍须在本机 DSH 中逐项验收。构建通过不代表这些运行行为已通过。

## 安装方式与支持边界

通过 DSH CLI 将当前源码目录添加到本机 profile：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-feiyuFM
```

桌面宿主缓存后端模块；安装后要从托盘完整退出再启动 DSH 才能载入修改。原生后端首次启动要求 Xcode Command Line Tools 提供 `/usr/bin/swiftc`。没有 macOS npm 发布版，也未改变 Windows 的音频与凭据实现。当前移植的完整验收以此记录后续补充，长期运行和跨 macOS 版本兼容性仍未知。
