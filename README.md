# 小蕾米 · 编辑器悬浮宠物

［KNOWN｜HIGH］使用原始“小蕾米”透明动画素材，在 macOS 的 VS Code 编辑器上方显示原生悬浮宠物。不是侧栏页面。当前安装包适用于 Apple Silicon，macOS 13 或更新版本。

［KNOWN｜HIGH］当前为 **0.1.1 预发布版**。[下载 VSIX 安装包](https://github.com/Elys1an-Y1san/remi-vscode-pet/releases/tag/v0.1.1)。自动化与宿主测试通过的项目和未完成的实机覆盖，分别记录在 `evidence/manual-qa.md` 中。

## 使用

- ［KNOWN｜HIGH］点击状态栏“小蕾米”可显示或隐藏。点击宠物打开快捷聊天，右键打开菜单。
- ［KNOWN｜HIGH］拖动移动位置；左右拖动使用对应原始动画。位置保存，随编辑器窗口移动。切换到其他应用后隐藏。
- ［KNOWN｜HIGH］鼠标移动时跟随视线；设置支持大小、关闭视线跟随和减少动态效果。
- ［KNOWN｜HIGH］任务、终端命令、调试会话显示真实状态；点击角标查看动态、打开终端、收起已完成记录。
- ［KNOWN｜HIGH］命令面板搜索“小蕾米”，可预览全部 9 种动作、重置位置、打开设置。

## 聊天与原版差异

［KNOWN｜HIGH］快捷聊天调用编辑器提供的语言模型，需要编辑器已有可用模型及相应登录。首次可选择模型；支持流式回复、停止和本次会话历史。不会自动发送文件内容，不保存聊天记录到磁盘。

［KNOWN｜HIGH］宠物素材保持原文件；9 种动作的帧数、帧时长及 16 方向映射根据本机原版实现核对。原图中多出的未使用格也保留，不重新绘制。

［KNOWN｜HIGH］原版账号内的云聊天、实时语音、屏幕分享、跨聊天审批及宠物云分享未接入。本扩展没有这些服务的授权接口，因此不宣称“全部功能一比一”。逐项对应见源码中的 `docs/parity.md`。

## 安装和开发

［KNOWN｜HIGH］在扩展页面菜单选择“Install from VSIX…”，打开 `remi-companion.vsix`。安装后执行“小蕾米：显示悬浮宠物”。

```sh
npm ci
npm test
npm run build
npm run test:host
npm run package
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
