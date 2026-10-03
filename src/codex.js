'use strict';
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const readline = require('node:readline');
const fs = require('node:fs');

function resolveExecutable(configured) {
  if(configured?.trim())return configured.trim();
  for(const app of ['ChatGPT','Codex']) {
    const binary=`/Applications/${app}.app/Contents/Resources/codex-cli/bin/codex`;
    if(fs.existsSync(binary))return binary;
  }
  return 'codex';
}

// A dedicated stdio connection. Authentication remains entirely inside the CLI.
class CodexClient extends EventEmitter {
  constructor({executable, cwd, spawnProcess=spawn, timeout=30000}={}) {
    super(); this.executable=resolveExecutable(executable); this.cwd=cwd; this.spawnProcess=spawnProcess;
    this.timeout=timeout; this.sequence=0; this.pending=new Map(); this.requests=new Map();
    this.closed=false; this.threadId=null; this.active=null;
  }
  async connect() {
    if (this.connection) return this.connection;
    this.connection=this.initialize(); return this.connection;
  }
  async initialize() {
    if (this.closed) throw Error('账号连接已关闭');
    this.child=this.spawnProcess(this.executable,['app-server','--stdio'],{cwd:this.cwd,stdio:['pipe','pipe','pipe'],shell:false});
    this.lines=readline.createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{try {this.receive(JSON.parse(line));} catch { /* Ignore non-protocol stdout. */ }});
    // Drain diagnostics without copying potential account or prompt data into editor logs.
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',()=>this.fail(Error('账号服务连接已断开')));
    this.child.on('error',error=>this.fail(Error(error.code==='ENOENT'?'找不到 Codex CLI，请设置 remi.codexPath。':`无法启动账号服务：${error.code || 'unknown'}`)));
    this.child.on('exit',()=>this.fail(Error('账号服务已退出，请重试')));
    await this.request('initialize',{clientInfo:{name:'remi_vscode_pet',title:'Remi companion',version:'0.2.0'},capabilities:{experimentalApi:true}});
    this.write({method:'initialized',params:{}});
  }
  write(message) {
    if (this.closed || !this.child?.stdin.writable) throw Error('账号连接不可用');
    this.child.stdin.write(JSON.stringify(message)+'\n');
  }
  request(method,params,timeout=this.timeout) {
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`账号服务超时：${method}`));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try {this.write({id,method,params});} catch(error) {clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  receive(message) {
    if ('id' in message && !message.method) {
      const waiter=this.pending.get(message.id); if(!waiter)return;
      clearTimeout(waiter.timer);this.pending.delete(message.id);
      if(message.error) waiter.reject(Error(message.error.message || '账号服务请求失败'));else waiter.resolve(message.result);
      return;
    }
    const p=message.params || {};
    if ('id' in message && message.method) {
      if(!this.active || this.active.cancelled || p.threadId!==this.threadId || (this.active.turnId && p.turnId && p.turnId!==this.active.turnId)) {
        this.write({id:message.id,error:{code:-32601,message:'No active Remi turn'}});return;
      }
      const controller=new AbortController();this.requests.set(message.id,controller);
      const respond=(result,error)=>{
        if(!this.requests.delete(message.id))return;
        controller.abort();
        try {this.write(error?{id:message.id,error}:{id:message.id,result});}catch{}
      };
      const active=this.active;
      const detail=active.tools.has(p.itemId)?{...p,item:active.tools.get(p.itemId)}:p;
      Promise.resolve().then(()=>active.onRequest?.(message.method,detail,controller.signal))
        .then(result=>result===undefined?respond(null,{code:-32601,message:'Unsupported client request'}):respond(result))
        .catch(()=>respond(null,{code:-32000,message:'Client request cancelled'}));
      return;
    }
    if(p.threadId!==this.threadId)return;
    if(message.method==='serverRequest/resolved') {
      this.requests.get(p.requestId)?.abort();this.requests.delete(p.requestId);return;
    }
    const active=this.active; if(!active || (active.turnId && p.turnId && p.turnId!==active.turnId))return;
    if(message.method==='turn/started') {active.turnId=p.turn.id;if(active.cancelled)this.interrupt();}
    if(message.method==='item/agentMessage/delta') {
      active.messages.set(p.itemId,(active.messages.get(p.itemId)||'')+p.delta);this.progress();
    }
    if(message.method==='item/completed' && p.item?.type==='agentMessage') {
      active.messages.set(p.item.id,p.item.text);this.progress();
    }
    if(message.method==='item/started' && ['commandExecution','fileChange','mcpToolCall'].includes(p.item?.type)) {
      active.tools.set(p.item.id,p.item);
      active.onActivity?.(p.item.type);
    }
    if(message.method==='turn/completed' && (!active.turnId || p.turn.id===active.turnId)) {
      this.finish(p.turn.error?Error(p.turn.error.message):null,p.turn.status==='interrupted');
    }
    if(message.method==='error' && p.willRetry===false)this.finish(Error(p.error?.message || '账号回复失败'));
  }
  progress() {this.active?.onText?.([...this.active.messages.values()].join('\n\n'));}
  async open(threadId=null,{ephemeral=false}={}) {
    await this.connect();
    if(this.active)throw Error('请先停止当前回复');
    // Explicitly use this workspace and require the user's approval for escalation.
    const options={cwd:this.cwd,sandbox:'read-only',approvalPolicy:'untrusted',approvalsReviewer:'user',
      developerInstructions:'你是小蕾米，一位粉发白翼、拿画板画笔的编辑器伙伴。自然、简短地回答。只在用户请求工作区操作时使用工具；不要声称执行了未执行的操作。'};
    const result=await this.request(threadId?'thread/resume':'thread/start',threadId?{...options,threadId}:{...options,ephemeral},120000);
    this.threadId=result.thread.id;return result.thread;
  }
  turn(text,{onText,onRequest,onActivity,signal}={}) {
    if(!this.threadId || this.active)return Promise.reject(Error('会话未就绪或正在回复'));
    if(signal?.aborted)return Promise.resolve({text:'',interrupted:true});
    return new Promise((resolve,reject)=>{
      const cancel=()=>{if(this.active){this.active.cancelled=true;this.interrupt();}};
      const timer=setTimeout(()=>{this.interrupt();this.finish(Error('回复超时，已请求停止'));},600000);
      this.active={resolve,reject,onText,onRequest,onActivity,messages:new Map(),tools:new Map(),timer,signal,cancel};
      const active=this.active;
      signal?.addEventListener('abort',cancel,{once:true});
      this.request('turn/start',{threadId:this.threadId,input:[{type:'text',text,text_elements:[]}]},120000)
        .then(result=>{if(this.active===active){active.turnId=result.turn.id;if(active.cancelled)this.interrupt();}})
        .catch(error=>{if(this.active===active)this.fail(error);});
    });
  }
  interrupt() {
    const active=this.active;if(!active)return;
    active.cancelled=true;
    if(active.turnId && !active.interruptSent) {
      active.interruptSent=true;
      this.request('turn/interrupt',{threadId:this.threadId,turnId:active.turnId})
        .catch(error=>this.finish(error));
    }
    // A disconnected or non-responsive server must not leave the UI busy forever.
    if(!active.cancelTimer)active.cancelTimer=setTimeout(()=>this.fail(Error('停止超时，连接已关闭')),10000);
  }
  finish(error,interrupted=false) {
    const active=this.active;if(!active)return;this.active=null;
    clearTimeout(active.timer);clearTimeout(active.cancelTimer);active.signal?.removeEventListener('abort',active.cancel);
    for(const controller of this.requests.values())controller.abort();this.requests.clear();
    if(error)active.reject(error);else active.resolve({text:[...active.messages.values()].join('\n\n'),interrupted});
  }
  fail(error) {
    if(this.closed)return;this.closed=true;this.finish(error);
    for(const waiter of this.pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}this.pending.clear();
    this.lines?.close();this.child?.stdin.end();
    this.child?.kill();this.emit('closed');
  }
  dispose() {this.fail(Error('账号连接已关闭'));}
}

function transcriptFromThread(thread) {
  return (thread.turns||[]).flatMap(turn=>(turn.items||[]).flatMap(item=>{
    if(item.type==='agentMessage')return [`小蕾米：${item.text}`];
    if(item.type==='userMessage')return [`你：${(item.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n')}`];
    return [];
  })).join('\n\n').slice(-60000);
}
module.exports={CodexClient,transcriptFromThread,resolveExecutable};
