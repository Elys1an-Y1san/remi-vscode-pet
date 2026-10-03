# 复刻范围与证据

［KNOWN｜HIGH］源宠物：小蕾米。经用户账号的宠物工具下载，1536 × 2288，8 × 11 格，每格 192 × 208。当前任务未更改账号激活宠物。

［KNOWN｜HIGH］核对日期：2026-10-03。本机原版资源用于只读行为核对，未将原版应用代码打包进扩展。动画播放器、状态桥接和原生窗口在此项目独立实现。

| 项目 | 当前实现 | 判定 |
| --- | --- | --- |
| 原角色外观 | 使用下载的原始文件 | ［KNOWN｜HIGH］原素材 |
| 9 种状态 | idle、左右拖动、招手、跳跃、失败、等待、工作、检查 | ［KNOWN｜HIGH］原帧及原时长 |
| 待机节奏 | 280/110/110/140/140/320 ms 各乘 6 | ［KNOWN｜HIGH］核对本机原版 |
| 非循环动作 | 播放 3 次回到待机 | ［KNOWN｜HIGH］核对本机原版 |
| 16 个视线方向 | 从上开始顺时针，每 22.5° 一个格 | ［KNOWN｜HIGH］原映射；跟随激活范围为本扩展设定 |
| 透明浮窗 | 原生非激活窗口，透明区域穿透 | ［KNOWN｜HIGH］本机实现 |
| 拖动 | 左右动作、位置保存、边界约束 | ［KNOWN｜HIGH］对应能力；无原版抛掷物理参数 |
| 工作状态 | 编辑器任务、终端、调试和第三方主动上报 | ［KNOWN｜HIGH］宿主适配；不等同原账号任务 |
| 动态列表 | 状态角标、打开、停止、收起 | ［KNOWN｜HIGH］对应能力；卡片布局独立实现 |
| 审批 | 本地扩展审批，以及本扩展账号会话的命令/文件审批、提问 | ［KNOWN｜HIGH］服务协议接入；不接管其他聊天 |
| 快捷聊天 | 编辑器模型或账号后端；流式回复、停止、新聊天 | ［COMPUTED｜HIGH］账号真实回复和中断通过 |
| 账号会话历史 | 恢复本扩展创建的 CLI 会话；未导入原版云聊天 | ［COMPUTED｜HIGH］真实持久化与重新连接恢复通过 |
| 图片/文本附件 | 选择、移除、发送、失败保留；原始图片字节/文本内容 | ［COMPUTED｜HIGH］真实账号和原生浮窗往返通过 |
| 其他文档 | 账号后端本地文件引用 | ［KNOWN｜HIGH］非云上传；解析依赖后端工具 |
| 文件拖入 / 图片粘贴 | 文件拖入已实现未实测；图片粘贴未实现 | ［KNOWN｜HIGH］仍有差距 |
| 实时语音 | 未实现；账号协议返回需要 API key 认证 | ［COMPUTED｜HIGH］见 realtime-probe.json |
| 屏幕上下文 | 未实现 | ［KNOWN｜HIGH］明确差距 |
| 宠物云分享、云管理 | 未实现 | ［KNOWN｜HIGH］明确差距 |
| 多种角色选择 | 仅用户要求的小蕾米 | ［KNOWN｜HIGH］单角色范围 |
| Windows / Linux | 不支持当前原生组件 | ［KNOWN｜HIGH］仅交付用户当前平台 |

［KNOWN｜HIGH］快捷聊天使用 [Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)。原生悬浮方案在 [Webview API](https://code.visualstudio.com/api/extension-guides/webview) 的面板能力之外，由扩展管理辅助进程。

［COMPUTED｜HIGH］0.2.0 使用 [Codex App Server](https://developers.openai.com/codex/app-server) 的正式协议复用本机登录；不读取或复制令牌。真实验证使用应用自带 CLI 0.159.0-alpha.12.1。系统 PATH 中的 0.144.1 曾因默认模型要求更高版本而失败，代码因此优先检测应用自带版本。

［KNOWN｜HIGH］修正 0.1.1 的范围说明：此前“没有授权服务接口”的表述过宽；已有正式账号服务协议，但其接入不等于原版云聊天同步或所有服务可用。语音等剩余能力尚未在此扩展完成。

［COMPUTED｜HIGH］0.3.0 语音探测：启动请求返回成功，但随后收到 `thread/realtime/error`，内容为 `realtime conversation requires API key auth`。这不属于语音已接通。探测没有访问麦克风，且不能据此断言其他服务或传输方式全部不可用。
