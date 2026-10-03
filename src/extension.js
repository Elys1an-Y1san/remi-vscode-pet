'use strict';
const vscode = require('vscode');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');
const { Activities, STATES } = require('./activity');

function activate(context) {
  const output = vscode.window.createOutputChannel('小蕾米');
  context.subscriptions.push(output);
  let child, ready = false, disposed = false, visible = context.globalState.get('visible', true);
  let lastConfig = {}, restartCount = 0, retryTimer, chatToken, selectedModel, chatHistory = [], transcript = '';
  const pending = new Map();
  const snapshotWaiters = new Set();
  const deferred = [];
  const actions = new Activities(() => send({ type: 'activities', ...actions.snapshot() }));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  status.text = '$(heart) 小蕾米'; status.command = 'remi.toggle'; status.tooltip = '显示 / 隐藏小蕾米'; status.show();
  context.subscriptions.push(status);
  const config = () => vscode.workspace.getConfiguration('remi');
  // Bind to this extension host's editor process, including isolated test profiles.
  let editorPID;
  try {
    let ancestor = process.pid;
    for (let i=0;i<8 && ancestor>1;i++) {
      const row=execFileSync('/bin/ps',['-p',String(ancestor),'-o','ppid=,comm='],{encoding:'utf8'}).trim();
      if (/\/Contents\/MacOS\/(Code|Electron)$/.test(row)) { editorPID=ancestor; break; }
      ancestor=Number(row.match(/^\d+/)?.[0]);
    }
  } catch { /* Native helper can still match the foreground editor. */ }
  function send(message) {
    if (ready && child?.stdin.writable) child.stdin.write(JSON.stringify(message)+'\n');
    else if (['bubble','animate','reset','snapshot'].includes(message.type)) {
      deferred.push(message); if(deferred.length>20) deferred.shift();
    }
  }
  function syncConfig() {
    const c = config(), pos = context.globalState.get('position', {});
    lastConfig = {type:'config', editorPID, alwaysVisible:c.get('alwaysVisible'), enabled:c.get('enabled') && visible, focused:vscode.window.state.focused, size:c.get('size'), followCursor:c.get('followCursor'), reducedMotion:c.get('reducedMotion'), ...pos};
    send(lastConfig);
    status.text = `${visible && c.get('enabled') ? '$(heart-filled)' : '$(heart)'} 小蕾米`;
  }
  function start() {
    if (disposed || child) return;
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      void vscode.window.showErrorMessage('这个悬浮版目前支持 Apple Silicon macOS。'); return;
    }
    const executable = context.asAbsolutePath('native/build/RemiOverlay.app/Contents/MacOS/RemiOverlay');
    if (!fs.existsSync(executable)) { void vscode.window.showErrorMessage('缺少小蕾米原生组件，请先运行 npm run build。'); return; }
    const proc = spawn(executable, [context.asAbsolutePath('assets/remi.png')], {stdio:['pipe','pipe','pipe']});
    child = proc;
    const lines = readline.createInterface({input:proc.stdout});
    lines.on('line', line => {
      try {
        const event = JSON.parse(line);
        void receive(event).catch(error => output.appendLine(`操作失败：${error.message}`));
      } catch { output.appendLine('忽略无效组件消息'); }
    });
    proc.stderr.on('data', data => output.append(data.toString()));
    proc.stdin.on('error', error => output.appendLine(`连接已断开：${error.message}`));
    proc.on('error', error => { output.appendLine(error.message); void vscode.window.showErrorMessage(`小蕾米启动失败：${error.message}`); });
    proc.on('exit', (code, signal) => {
      lines.close(); if (child === proc) child = undefined; ready = false;
      output.appendLine(`浮窗退出：${code ?? signal}`);
      if (!disposed && restartCount++ < 2) retryTimer = setTimeout(start, 700);
      else if (!disposed) void vscode.window.showErrorMessage('小蕾米浮窗连续退出，请查看“小蕾米”输出日志。');
    });
  }
  async function receive(event) {
    switch (event.type) {
      case 'ready': ready = true; output.appendLine(`浮窗就绪，${event.frames} 帧，PID ${event.pid}`); syncConfig(); send({type:'activities', ...actions.snapshot()}); for(const message of deferred.splice(0))send(message); break;
      case 'position':
        if (Number.isFinite(event.x) && Number.isFinite(event.y)) await context.globalState.update('position',{offsetX:event.x,offsetY:event.y}); break;
      case 'hide': visible = false; await context.globalState.update('visible',false); syncConfig(); break;
      case 'settings': await vscode.commands.executeCommand('workbench.action.openSettings','@ext:local-remi.remi-companion'); break;
      case 'dismiss': actions.dismiss(event.id); break;
      case 'action': await actions.act(event.id,event.action); break;
      case 'chat': if (typeof event.text === 'string' && event.text.trim()) await chat(event.text.slice(0,16000)); break;
      case 'cancelChat': chatToken?.cancel(); break;
      case 'openChat': await vscode.commands.executeCommand('workbench.action.chat.open'); break;
      case 'error': void vscode.window.showErrorMessage(event.message); break;
      case 'snapshot': for (const waiter of snapshotWaiters) waiter(event); snapshotWaiters.clear(); break;
    }
  }
  async function chat(text) {
    if (chatToken) { send({type:'chat',text:transcript,busy:true}); return; }
    const token = new vscode.CancellationTokenSource(); chatToken = token;
    const before = transcript;
    transcript += `${transcript ? '\n\n' : ''}你：${text}\n\n小蕾米：`;
    send({type:'chat',text:transcript+'正在连接模型…',busy:true});
    actions.update('remi-chat',{title:'与小蕾米聊天',state:'running',body:'正在回复'}, {cancel:()=>token.cancel()});
    try {
      if (!vscode.workspace.isTrusted) throw new Error('当前工作区处于受限模式。请在编辑器中信任你自己的工作区，然后再使用聊天模型。');
      const modelID = config().get('model');
      const models = await vscode.lm.selectChatModels(modelID ? {id:modelID} : {});
      if (!models.length) throw new Error('没有可用的聊天模型。请先在编辑器的 Chat 中登录或添加模型，再重试。');
      let model = models.find(m=>m.id===selectedModel) || (models.length===1 ? models[0] : undefined);
      if (!model) {
        const choice = await vscode.window.showQuickPick(models.map(m=>({label:m.name,description:`${m.vendor} · ${m.id}`,model:m})),{title:'选择小蕾米的聊天模型'});
        if (!choice) { transcript = before; return; } model = choice.model; selectedModel = model.id;
      }
      if (token.token.isCancellationRequested) { transcript += '[已停止]'; return; }
      const messages = [vscode.LanguageModelChatMessage.User('你是小蕾米，一位粉发白翼、拿着画板画笔的桌面伙伴。自然、简短地回答。你只能看到用户发送的消息；不要声称能看到编辑器文件或执行工具。'),...chatHistory.slice(-12),vscode.LanguageModelChatMessage.User(text)];
      const reply = await model.sendRequest(messages,{},token.token);
      let result = '', lastSend = 0;
      for await (const fragment of reply.text) {
        if (token.token.isCancellationRequested) break;
        result += fragment;
        if (Date.now()-lastSend > 60) { send({type:'chat',text:transcript+result,busy:true}); lastSend = Date.now(); }
      }
      if (token.token.isCancellationRequested) transcript += result+'\n[已停止]';
      else { transcript += result; chatHistory.push(vscode.LanguageModelChatMessage.User(text),vscode.LanguageModelChatMessage.Assistant(result)); }
      // Keep in-memory transcript and request payload bounded; never write chat contents to disk.
      transcript = transcript.slice(-60000); chatHistory = chatHistory.slice(-12);
    } catch (error) {
      transcript += token.token.isCancellationRequested ? '[已停止]' : `\n${error.message || '回复失败，请重试。'}`;
    } finally {
      actions.remove('remi-chat'); chatToken = undefined; token.dispose(); send({type:'chat',text:transcript,busy:false});
    }
  }
  function register(name, fn) { context.subscriptions.push(vscode.commands.registerCommand(name,fn)); }
  async function show() { visible = true; await context.globalState.update('visible',true); if (!config().get('enabled')) await config().update('enabled',true,vscode.ConfigurationTarget.Global); start(); syncConfig(); }
  register('remi.show', show);
  register('remi.hide', async()=>{ visible=false; await context.globalState.update('visible',false); send({type:'hide'}); syncConfig(); });
  register('remi.toggle', ()=>vscode.commands.executeCommand(visible ? 'remi.hide' : 'remi.show'));
  register('remi.chat', async()=>{await show(); send({type:'bubble',mode:'chat'});});
  register('remi.activities', async()=>{await show(); send({type:'bubble',mode:'activities'});});
  register('remi.resetPosition', ()=>{send({type:'reset'});});
  register('remi.settings', ()=>vscode.commands.executeCommand('workbench.action.openSettings','@ext:local-remi.remi-companion'));
  register('remi.animations', async()=>{
    const names = {'idle':'待机','running-right':'向右拖动','running-left':'向左拖动','waving':'招手','jumping':'跳跃','failed':'失败','waiting':'等待确认','running':'工作','review':'检查完成'};
    const choice = await vscode.window.showQuickPick([...STATES].map(state=>({label:names[state],description:state,state})),{title:'预览原始动画'});
    if (choice) { await show(); send({type:'animate',state:choice.state}); }
  });
  // A diagnostic readback command for real extension-host tests; no application mutation.
  register('remi.inspect', async()=>{
    const native = ready ? await new Promise(resolve=>{
      const finish=value=>{clearTimeout(timeout);snapshotWaiters.delete(finish);resolve(value);};
      const timeout=setTimeout(()=>finish(null),2000); snapshotWaiters.add(finish);send({type:'snapshot'});
    }) : null;
    return {ready,visible,...actions.snapshot(),native};
  });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('remi')) syncConfig();}));
  context.subscriptions.push(vscode.window.onDidChangeWindowState(e=>send({type:'focus',focused:e.focused})));

  let sequence = 0;
  const taskIDs = new WeakMap(), shellIDs = new WeakMap(), debugIDs = new Map();
  const tracked = () => config().get('trackTasks');
  context.subscriptions.push(vscode.tasks.onDidStartTask(e=>{
    if (!tracked()) return;
    const id = `task-${++sequence}`; taskIDs.set(e.execution,id);
    actions.update(id,{title:e.execution.task.name,state:'running',body:'任务正在执行'}, {open:()=>vscode.commands.executeCommand('workbench.action.terminal.focus'),cancel:()=>e.execution.terminate()});
  }));
  context.subscriptions.push(vscode.tasks.onDidEndTaskProcess(e=>{
    const id = taskIDs.get(e.execution); if (!id) return;
    const failed = e.exitCode !== undefined && e.exitCode !== 0;
    actions.update(id,{title:e.execution.task.name,state:failed?'failed':'review',body:e.exitCode === undefined ? '进程已结束，未报告退出码' : `退出码 ${e.exitCode}`},{open:()=>vscode.commands.executeCommand('workbench.action.terminal.focus')});
  }));
  context.subscriptions.push(vscode.tasks.onDidEndTask(e=>{
    const id = taskIDs.get(e.execution); if (id && actions.items.get(id)?.state==='running') actions.update(id,{title:e.execution.task.name,state:'review',body:'任务已结束，未报告进程退出码'},{open:()=>vscode.commands.executeCommand('workbench.action.terminal.focus')});
  }));
  if (vscode.window.onDidStartTerminalShellExecution) {
    context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(e=>{
      if (!tracked()) return;
      const id = `shell-${++sequence}`; shellIDs.set(e.execution,id);
      // Do not expose command arguments, which may contain secrets, in notifications.
      actions.update(id,{title:`终端 · ${e.terminal.name}`,state:'running',body:'命令正在执行'}, {open:()=>e.terminal.show()});
    }));
    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(e=>{
      const id = shellIDs.get(e.execution); if(!id) return;
      actions.update(id,{title:`终端 · ${e.terminal.name}`,state:e.exitCode !== undefined && e.exitCode !== 0?'failed':'review',body:e.exitCode===undefined?'命令已结束，未报告退出码':`退出码 ${e.exitCode}`},{open:()=>e.terminal.show()});
    }));
  }
  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session=>{
    if(!tracked()) return; const id=`debug-${session.id}`; debugIDs.set(session.id,id);
    actions.update(id,{title:session.name,state:'running',body:'调试会话'}, {open:()=>vscode.commands.executeCommand('workbench.debug.action.focusRepl'),cancel:()=>vscode.debug.stopDebugging(session)});
  }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session=>{
    const id=debugIDs.get(session.id); if(id) actions.update(id,{title:session.name,state:'review',body:'调试会话已结束'}); debugIDs.delete(session.id);
  }));
  const api = {
    version:1,
    updateActivity(id, value, callbacks={}) { actions.update(`external:${id}`,value,callbacks); },
    removeActivity(id) { actions.remove(`external:${id}`); },
    requestApproval(id, title, body) {
      const key=`approval:${id}`;
      if(pending.has(key)) throw new Error('Approval ID already pending');
      return new Promise(resolve=>{
        const finish = allowed=>{if(!pending.has(key)) return; pending.delete(key); actions.remove(key); resolve(allowed);};
        pending.set(key,()=>finish(false));
        actions.update(key,{title,body,state:'waiting'},{approve:()=>finish(true),deny:()=>finish(false)});
      });
    },
    animate(state) { if (!STATES.has(state)) throw new TypeError('Unknown state'); send({type:'animate',state}); },
    inspect() { return {ready,visible,...actions.snapshot()}; }
  };
  context.subscriptions.push({dispose(){
    disposed = true; clearTimeout(retryTimer); chatToken?.cancel();
    for(const cancel of pending.values()) cancel();
    send({type:'quit'}); child?.stdin.end();
    const processToStop=child; const killTimer=setTimeout(()=>processToStop?.kill(),1000); killTimer.unref();
  }});
  start(); return api;
}
module.exports = { activate };
