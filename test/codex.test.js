'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {CodexClient,transcriptFromThread}=require('../src/codex');
const tick=()=>new Promise(r=>setImmediate(r));

async function fixture() {
  const child=new EventEmitter(),sent=[];child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');
  child.stdin=new Writable({write(data,_,done){
    const m=JSON.parse(data.toString());sent.push(m);
    if(m.method==='initialize')queueMicrotask(()=>emit({id:m.id,result:{}}));
    if(m.method==='thread/start'||m.method==='thread/resume')queueMicrotask(()=>emit({id:m.id,result:{thread:{id:m.params.threadId||'own-thread',turns:[]}}}));
    if(m.method==='turn/interrupt')queueMicrotask(()=>emit({id:m.id,result:{}}));done();
  }});
  const client=new CodexClient({cwd:'/workspace',spawnProcess:()=>child,timeout:1000});await client.open();
  const event=(method,params={})=>emit({method,params:{threadId:'own-thread',...params}});
  const begin=()=>{const m=sent.findLast(x=>x.method==='turn/start');emit({id:m.id,result:{turn:{id:'turn-1'}}});event('turn/started',{turn:{id:'turn-1'}});};
  const finish=(status='completed')=>event('turn/completed',{turn:{id:'turn-1',status}});
  return{client,child,sent,emit,event,begin,finish,dispose:()=>{client.dispose();child.stdout.end();child.stderr.end();}};
}

test('account text streams in item order; final items replace deltas without duplication',async()=>{
  const f=await fixture(),updates=[];try{
    const result=f.client.turn('Hello',{onText:t=>updates.push(t)});f.begin();
    f.event('item/agentMessage/delta',{itemId:'a',delta:'Hi'});
    f.event('item/agentMessage/delta',{threadId:'other',itemId:'a',delta:'secret'});
    f.event('item/completed',{item:{type:'agentMessage',id:'a',text:'Hi!'}});
    f.event('item/completed',{item:{type:'agentMessage',id:'b',text:'Done'}});f.finish();
    assert.deepEqual(await result,{text:'Hi!\n\nDone',interrupted:false});assert.equal(updates[0],'Hi');
    const start=f.sent.find(m=>m.method==='thread/start');assert.equal(start.params.sandbox,'read-only');assert.equal(start.params.approvalPolicy,'untrusted');
  }finally{f.dispose();}
});

test('cancellation before turn/start response interrupts exactly the returned turn',async()=>{
  const f=await fixture();try{
    const controller=new AbortController();const result=f.client.turn('Hello',{signal:controller.signal});controller.abort();
    assert.equal(f.sent.filter(m=>m.method==='turn/interrupt').length,0);f.begin();await tick();
    const interrupts=f.sent.filter(m=>m.method==='turn/interrupt');assert.equal(interrupts.length,1);assert.equal(interrupts[0].params.turnId,'turn-1');
    f.finish('interrupted');assert.equal((await result).interrupted,true);
  }finally{f.dispose();}
});

test('requests from other threads are rejected; unsupported methods never gain approval',async()=>{
  const f=await fixture();try{
    let requests=0;const result=f.client.turn('Hello',{onRequest:async()=>{requests++;return undefined;}});f.begin();
    f.emit({id:'foreign',method:'item/commandExecution/requestApproval',params:{threadId:'other'}});
    f.emit({id:'unknown',method:'future/action',params:{threadId:'own-thread'}});await tick();
    assert.equal(requests,1);for(const id of ['foreign','unknown'])assert.equal(f.sent.find(m=>m.id===id).error.code,-32601);
    f.finish();await result;
  }finally{f.dispose();}
});

test('resolved approval is aborted and late UI response is discarded',async()=>{
  const f=await fixture();try{
    let resolve,signal;const result=f.client.turn('Hello',{onRequest:async(_m,_p,s)=>{signal=s;return new Promise(r=>resolve=r);}});f.begin();
    f.emit({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'own-thread'}});await tick();
    f.event('serverRequest/resolved',{requestId:'approval'});assert.equal(signal.aborted,true);
    resolve({decision:'accept'});await tick();assert.equal(f.sent.some(m=>m.id==='approval'),false);
    f.finish();await result;
  }finally{f.dispose();}
});

test('server exit rejects outstanding turn and all RPC promises',async()=>{
  const f=await fixture();try{
    const turn=f.client.turn('Hello');const pending=f.client.request('some/read',{});
    const checks=[assert.rejects(turn,/退出/),assert.rejects(pending,/退出/)];f.child.emit('exit',1);await Promise.all(checks);
    assert.equal(f.client.closed,true);assert.equal(f.client.pending.size,0);
  }finally{f.dispose();}
});

test('resume transcript includes user and assistant text only',()=>{
  assert.equal(transcriptFromThread({turns:[{items:[{type:'userMessage',content:[{type:'text',text:'Question'}]},{type:'commandExecution',command:'secret'},{type:'agentMessage',text:'Answer'}]}]}),'你：Question\n\n小蕾米：Answer');
});

test('resumed attachment messages keep filenames without dumping the transport payload',()=>{
  const {codexInput}=require('../src/attachments');
  const input=codexInput('Read the note',[{name:'note.txt',kind:'text',text:'private file body'}]);
  const transcript=transcriptFromThread({turns:[{items:[{type:'userMessage',content:input}]}]});
  assert.ok(transcript.includes('note.txt'));assert.ok(!transcript.includes('private file body'));
});

test('file approval includes the proposed diff from its matching item',async()=>{
  const f=await fixture();try{
    let detail;const result=f.client.turn('Edit',{onRequest:async(_method,params)=>{detail=params;return{decision:'decline'};}});f.begin();
    f.event('item/started',{item:{type:'fileChange',id:'change',changes:[{path:'test.txt',diff:'-old\n+new'}]}});
    f.emit({id:'file-approval',method:'item/fileChange/requestApproval',params:{threadId:'own-thread',itemId:'change'}});await tick();
    assert.equal(detail.item.changes[0].diff,'-old\n+new');assert.equal(f.sent.find(m=>m.id==='file-approval').result.decision,'decline');
    f.finish();await result;
  }finally{f.dispose();}
});
