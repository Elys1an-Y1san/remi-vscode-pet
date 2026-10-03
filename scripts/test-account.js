'use strict';
// Explicit, opt-in live test. Uses CLI login, creates only its own test thread,
// archives that thread after testing, and never publishes account IDs or text.
const {CodexClient,transcriptFromThread}=require('../src/codex');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
async function run(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'remi-account-test-'));
 let client=new CodexClient({cwd}),threadId;
 try{
  const thread=await client.open();threadId=thread.id;
  let updates=0;
  const reply=await client.turn('这是小蕾米插件的自动化连接测试。不要调用工具。只回复 REMI_ACCOUNT_OK。',{onText:()=>updates++,onRequest:async()=>undefined});
  assert.equal(reply.text.trim(),'REMI_ACCOUNT_OK');assert.ok(updates>0);
  client.dispose();client=new CodexClient({cwd});
  const resumed=await client.open(threadId);
  assert.ok(transcriptFromThread(resumed).includes('小蕾米：REMI_ACCOUNT_OK'));
  const controller=new AbortController();let cancelUpdates=0;
  const stopped=await client.turn('不要调用工具。从 1 逐行数到 500，每行输出一个数字。',{signal:controller.signal,onText:()=>{cancelUpdates++;controller.abort();},onRequest:async()=>undefined});
  assert.ok(cancelUpdates>0);assert.equal(stopped.interrupted,true);
  await client.request('thread/archive',{threadId});threadId=null;
  const report={date:new Date().toISOString(),realAccountReply:true,streamedUpdates:updates,persistentResume:true,cancelAfterFirstStream:true,interrupted:true,testThreadArchived:true};
  fs.writeFileSync(path.join(__dirname,'../evidence/account-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{
  if(threadId&&!client.closed)await client.request('thread/archive',{threadId}).catch(()=>{});
  client.dispose();fs.rmSync(cwd,{recursive:true,force:true});
 }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
