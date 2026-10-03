# 小蕾米 · 编辑器悬浮宠物

［KNOWN｜HIGH］使用原始“小蕾米”透明动画素材，在 macOS 的 VS Code 编辑器上方显示原生悬浮宠物。不是侧栏页面。当前安装包适用于 Apple Silicon，macOS 13 或更新版本。

［KNOWN｜HIGH］当前为 **0.3.0 预发布版**。[下载 VSIX 安装包](https://github.com/Elys1an-Y1san/remi-vscode-pet/releases/tag/v0.3.0)。自动化与宿主测试通过的项目和未完成的实机覆盖，分别记录在 `evidence/manual-qa.md` 中。

## 使用

- ［KNOWN｜HIGH］点击状态栏“小蕾米”可显示或隐藏。点击宠物打开快捷聊天，右键打开菜单。
- ［KNOWN｜HIGH］拖动移动位置；左右拖动使用对应原始动画。位置保存，随编辑器窗口移动。切换到其他应用后隐藏。
- ［KNOWN｜HIGH］鼠标移动时跟随视线；设置支持大小、关闭视线跟随和减少动态效果。
- ［KNOWN｜HIGH］任务、终端命令、调试会话显示真实状态；点击角标查看动态、打开终端、收起已完成记录。
- ［KNOWN｜HIGH］命令面板搜索“小蕾米”，可预览全部 9 种动作、重置位置、打开设置。

## 聊天与原版差异

［KNOWN｜HIGH］快捷聊天调用编辑器提供的语言模型，需要编辑器已有可用模型及相应登录。首次可选择模型；支持流式回复、停止和本次会话历史。此默认后端不会自动发送文件内容，聊天记录仅保留在内存。

［KNOWN｜HIGH］宠物素材保持原文件；9 种动作的帧数、帧时长及 16 方向映射根据本机原版实现核对。原图中多出的未使用格也保留，不重新绘制。

［COMPUTED｜HIGH］新增可选 **Codex 账号后端**：设置 `remi.chatBackend` 为 `codex`，复用本机 CLI 登录。留空 `remi.codexPath` 时优先检测已安装应用自带的 CLI，再尝试 PATH。支持流式回复、停止、新聊天、恢复本扩展创建的历史会话、命令/文件操作审批及服务端提问。原生浮窗显示当前后端。

［KNOWN｜HIGH］账号后端可读取当前工作区，采用只读沙箱和服务端 `untrusted` 审批策略；服务端请求额外授权时，动态列表中的“查看”会显示完整请求，再由用户单次允许或拒绝。模型和工具能力由本机 CLI 配置决定。CLI 保存会话历史；扩展仅保存会话 ID 和首条消息的前 80 字作为标题，最多 50 条。切换工作区后历史入口分别记录。它不导入其他扩展或原版云聊天。

［COMPUTED｜HIGH］真实账号流式回复、断开重连后的会话恢复、首次输出后中断已通过；协议依据 [Codex App Server 官方文档](https://developers.openai.com/codex/app-server)。旧 CLI 可能无法使用新模型，可通过 `remi.codexPath` 指定更新版本。

［KNOWN｜HIGH］原版云聊天同步、实时语音、屏幕分享、跨聊天审批及宠物云分享仍未接入，不宣称“全部功能一比一”。逐项对应见源码中的 `docs/parity.md`。

## 附件

［KNOWN｜HIGH］在聊天浮窗点击“附件”选择文件，列表支持逐项移除；选择附件和切换面板时保留当前输入草稿。每次最多 8 个文件、总计 16 MB。可只发送附件，不填写问题。

［KNOWN｜HIGH］图片以原始字节发送，支持 PNG、JPEG、GIF、WebP；小于等于 256 KiB 的 UTF-8 文本以文本资料发送。其他文档及较大的文本显示为“本地引用”，仅账号后端支持按需读取，不能保证模型运行环境具有每种文档的解析工具。图片输入需要支持图片的模型；不支持时保留附件并提示，不会静默忽略。

［COMPUTED｜HIGH］真实账号及原生浮窗均已收到图片和文本附件并返回准确内容。成功回复后清空本次附件，失败或中断时保留。发送前选择的图片与文本按当时内容保留；本地引用在发送前检查文件是否发生改变。文件拖入入口已实现，但受界面自动化限制，物理拖入尚未验证；剪贴板图片粘贴尚未实现。

## 安装和开发

［KNOWN｜HIGH］在扩展页面菜单选择“Install from VSIX…”，打开 `remi-companion.vsix`。安装后执行“小蕾米：显示悬浮宠物”。

```sh
npm ci
npm test
npm run build
npm run test:host
npm run package
# 可选：调用真实账号，创建并归档独立测试会话
npm run test:account
# 可选：合成图片和文本的真实账号验证
npm run test:attachments
```

［KNOWN｜HIGH］构建原生组件需要系统 Swift 编译器；安装包自带已构建组件，使用时不需要编译。运行时无 npm 依赖，不修改编辑器安装文件，不申请辅助功能权限，不启动网络监听服务。

［KNOWN｜HIGH］宿主测试会启动独立测试配置的编辑器，不读取或修改日常编辑器配置；设置 `REMI_CODE_BIN` 可以指定编辑器命令路径。原生程序使用本地 ad-hoc 签名，未作发行者公证。

## 其他扩展接入任务与审批

```js
const remi = await vscode.extensions.getExtension('local-remi.remi-companion').activate();
remi.updateActivity('build', {title: 'Build', state: 'running'}, {open: () => terminal.show()});
const allowed = await remi.requestApproval('deploy-1', '是否部署？', '目标：预览环境');
if (allowed) { /* 调用方执行自己已向用户说明的操作 */ }
remi.updateActivity('build', {title: 'Build', state: 'review'});
```

［KNOWN｜HIGH］接入方主动上报任务；本扩展不读取其他 AI 扩展的私有记录。允许和拒绝按钮只完成对应请求，不自动执行任意命令。关闭扩展时未完成审批返回拒绝。

［KNOWN｜HIGH］协议类型见源码中的 `src/api.d.ts`，真实宿主测试报告见 `evidence/extension-host.json`。
