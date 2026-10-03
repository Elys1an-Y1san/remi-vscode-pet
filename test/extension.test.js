const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {Activities,STATES}=require('../src/activity');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}throw Error('Expected extension event not received');}

function harness({store=new Map(),trusted=true,models=[],settings={},accountClass}={}){
 const handlers=new Map(),messages=[],commands=new Map();
 const event=name=>fn=>{handlers.set(name,fn);return{dispose(){handlers.delete(name);}};};
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
 child.stdin=new Writable({write(data,_,done){messages.push(JSON.parse(data.toString()));done();}});child.kill=()=>{};
 const native=value=>child.stdout.write(JSON.stringify(value)+'\n');
 const subscriptions=[];
 const state={models,errors:[]};
 const vscode={
  window:{state:{focused:true},createOutputChannel:()=>({append(){},appendLine(){},dispose(){}}),
   createStatusBarItem:()=>({show(){},dispose(){}}),showErrorMessage:async text=>state.errors.push(text),
   showQuickPick:async rows=>rows[0],showWarningMessage:async(_text,options)=>{state.detail=options.detail;return '单次允许';},showInformationMessage:async()=>{},onDidChangeWindowState:event('focus'),
   onDidStartTerminalShellExecution:event('shellStart'),onDidEndTerminalShellExecution:event('shellEnd')},
  workspace:{workspaceFolders:[{uri:{fsPath:'/test'}}],isTrusted:trusted,getConfiguration:()=>({get:(key,fallback)=>({...{enabled:true,size:112,followCursor:true,reducedMotion:false,alwaysVisible:false,trackTasks:true,model:''},...settings}[key]??fallback),update:async()=>{}}),onDidChangeConfiguration:event('config')},
  commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return{dispose(){commands.delete(name);}};},executeCommand:async(name,...args)=>commands.get(name)?.(...args)},
  StatusBarAlignment:{Right:1},ConfigurationTarget:{Global:1},
  tasks:{onDidStartTask:event('taskStart'),onDidEndTaskProcess:event('taskProcessEnd'),onDidEndTask:event('taskEnd')},
  debug:{onDidStartDebugSession:event('debugStart'),onDidTerminateDebugSession:event('debugEnd')},
  CancellationTokenSource:class{constructor(){this.token={isCancellationRequested:false};}cancel(){this.token.isCancellationRequested=true;}dispose(){}},
  lm:{selectChatModels:async()=>state.models},
  LanguageModelChatMessage:{User:content=>({role:'user',content}),Assistant:content=>({role:'assistant',content})},
  LanguageModelTextPart:class{constructor(value){this.value=value;}},LanguageModelDataPart:{image:(data,mime)=>({data,mime})}
 };
 const context={subscriptions,globalState:{get:(key,fallback)=>store.has(key)?store.get(key):fallback,update:async(key,value)=>store.set(key,value)},asAbsolutePath:file=>path.resolve(file)};
 const box={module:{exports:{}},exports:{},process:{platform:'darwin',arch:'arm64',pid:123},setTimeout,clearTimeout,console,AbortController,
  require:id=>id==='vscode'?vscode:id==='node:child_process'?{spawn:()=>child,execFileSync:()=> '1 /Applications/Code.app/Contents/MacOS/Code'}:id==='node:fs'?{existsSync:()=>true}:id==='./activity'?{Activities,STATES}:id==='./codex'?{...require('../src/codex'),...(accountClass?{CodexClient:accountClass}:{})}:id==='./attachments'?require('../src/attachments'):require(id)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/extension.js'),'utf8'),box);
 const api=box.module.exports.activate(context);native({type:'ready',frames:73,pid:222});
 return{api,native,messages,commands,handlers,state,store,dispose(){for(const disposable of subscriptions)disposable.dispose();child.stdout.end();child.stderr.end();}};
}

test('native position and visibility persist across extension reactivation',async()=>{
 const store=new Map();let h=harness({store});
 h.native({type:'position',x:-420,y:125});await tick();
 await h.commands.get('remi.hide')();h.dispose();
 h=harness({store});const config=h.messages.find(m=>m.type==='config');
 assert.equal(config.offsetX,-420);assert.equal(config.offsetY,125);assert.equal(config.enabled,false);
 h.native({type:'position',x:'bad',y:NaN});await tick();assert.equal(store.get('position').offsetX,-420);
 await h.commands.get('remi.show')();assert.equal(store.get('visible'),true);h.dispose();
});

test('approval routing resolves once, rejects duplicate IDs, and denies on disposal',async()=>{
 const h=harness();const approval=h.api.requestApproval('one','Approve?','Test');
 assert.throws(()=>h.api.requestApproval('one','Duplicate',''));
 h.native({type:'action',id:'approval:one',action:'approve'});assert.equal(await approval,true);
 h.native({type:'action',id:'approval:one',action:'deny'});assert.equal(h.api.inspect().items.length,0);
 const pending=h.api.requestApproval('two','Pending','');h.dispose();assert.equal(await pending,false);
});

test('chat streams provider response and includes previous turns only in memory',async()=>{
 const prompts=[];
 const model={id:'test-model',name:'Test',vendor:'fixture',async sendRequest(messages){prompts.push(messages);return{text:(async function*(){yield 'Hello';yield ' world';})()};}};
 const h=harness({models:[model]});h.native({type:'chat',text:'First'});
 await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('Hello world')));
 assert.equal(h.api.inspect().items.length,0);
 h.native({type:'chat',text:'Second'});await until(()=>prompts.length===2&&h.messages.findLast(m=>m.type==='chat')?.busy===false);
 assert.ok(prompts[1].some(m=>m.content==='First'));assert.ok(prompts[1].some(m=>m.content==='Hello world'));
 assert.equal(h.store.size,0);h.dispose();
});

test('unavailable model and restricted workspace produce truthful recoverable errors',async()=>{
 for(const [trusted,expected] of [[true,'没有可用'],[false,'受限模式']]){
  const h=harness({trusted});h.native({type:'chat',text:'Hello'});
  await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes(expected)));
  assert.equal(h.api.inspect().items.length,0);h.dispose();
 }
});

test('cancel during model selection never sends a request and clears busy state',async()=>{
 let choose;let requested=false;
 const model={id:'slow',sendRequest:()=>{requested=true;}};
 const h=harness();h.state.models=new Promise(resolve=>{choose=resolve;});
 h.native({type:'chat',text:'Hello'});h.native({type:'cancelChat'});choose([model]);
 await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('已停止')));
 assert.equal(requested,false);assert.equal(h.api.inspect().items.length,0);h.dispose();
});

test('provider failure clears the work state instead of leaving a stuck animation',async()=>{
 const h=harness({models:[{id:'failure',async sendRequest(){throw Error('Test provider disconnected');}}]});
 h.native({type:'chat',text:'Hello'});await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('disconnected')));
 assert.equal(h.api.inspect().state,'idle');h.dispose();
});

test('account backend routes a full approval through explicit review and persists only session metadata',async()=>{
 const longCommand='a'.repeat(1000);let decision;
 class FakeAccount extends EventEmitter {
  async open(){return{id:'own',turns:[]};}
  async turn(_text,{onText,onRequest}){onText('Reply');decision=await onRequest('item/commandExecution/requestApproval',{threadId:'own',command:longCommand},new AbortController().signal);return{text:'Reply',interrupted:false};}
  dispose(){this.closed=true;this.emit('closed');}
 }
 const h=harness({settings:{chatBackend:'codex'},accountClass:FakeAccount});
 try{
  h.native({type:'chat',text:'Check project'});
  await until(()=>h.api.inspect().items.some(i=>i.id.startsWith('codex-request:')));
  const activity=h.api.inspect().items.find(i=>i.id.startsWith('codex-request:'));
  assert.deepEqual(Array.from(activity.actions),['open','deny']);
  h.native({type:'action',id:activity.id,action:'open'});
  await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('Reply')));
  assert.equal(decision.decision,'accept');assert.ok(h.state.detail.includes(longCommand));
  assert.equal(h.store.get('codexSessions')[0].id,'own');assert.equal(h.api.inspect().items.length,0);
 }finally{h.dispose();}
});

test('account backend never starts in an untrusted workspace',async()=>{
 let started=false;
 class FakeAccount{constructor(){started=true;}}
 const h=harness({trusted:false,settings:{chatBackend:'codex'},accountClass:FakeAccount});
 try{h.native({type:'chat',text:'Hello'});await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('受限模式')));assert.equal(started,false);}finally{h.dispose();}
});

test('stopping while an approval is open resolves it as decline and clears pending cards',async()=>{
 let answer;
 class FakeAccount extends EventEmitter {
  async open(){return{id:'own',turns:[]};}
  async turn(_text,{onRequest,signal}){answer=await onRequest('item/commandExecution/requestApproval',{threadId:'own',command:'test'},signal);return{text:'',interrupted:true};}
  dispose(){this.closed=true;this.emit('closed');}
 }
 const h=harness({settings:{chatBackend:'codex'},accountClass:FakeAccount});
 try{h.native({type:'chat',text:'Hello'});await until(()=>h.api.inspect().state==='waiting');h.native({type:'cancelChat'});await until(()=>answer);assert.equal(answer.decision,'decline');await until(()=>h.api.inspect().items.length===0);}finally{h.dispose();}
});


test('image-only draft reaches account input and is removed only after success',async()=>{
 const os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'remi-image-'));const file=path.join(dir,'image.png');
 fs.writeFileSync(file,Buffer.from([137,80,78,71,13,10,26,10]));let input;
 class FakeAccount extends EventEmitter{async open(){return{id:'image-thread'};}async turn(_text,options){input=options.input;return{text:'Image reply',interrupted:false};}dispose(){this.closed=true;}}
 const h=harness({settings:{chatBackend:'codex'},accountClass:FakeAccount});
 try{h.native({type:'addAttachments',paths:[file]});await until(()=>h.messages.findLast(m=>m.type==='attachments')?.items.length===1);
 h.native({type:'chat',text:''});await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('Image reply')));
 assert.equal(input[1].type,'image');assert.equal(h.messages.findLast(m=>m.type==='attachments').items.length,0);
 }finally{h.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});

test('unsupported images stay attached and never reach a text-only provider',async()=>{
 const os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'remi-image-'));const file=path.join(dir,'image.png');
 fs.writeFileSync(file,Buffer.from([137,80,78,71,13,10,26,10]));let sent=false;
 const h=harness({models:[{id:'text',capabilities:{imageInput:false},sendRequest:async()=>{sent=true;}}]});
 try{h.native({type:'addAttachments',paths:[file]});await until(()=>h.messages.findLast(m=>m.type==='attachments')?.items.length===1);
 h.native({type:'chat',text:'Look'});await until(()=>h.messages.some(m=>m.type==='chat'&&!m.busy&&m.text.includes('不支持图片')));
 assert.equal(sent,false);assert.equal(h.messages.findLast(m=>m.type==='attachments').items.length,1);
 }finally{h.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
