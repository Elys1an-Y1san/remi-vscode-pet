'use strict';
// Synthetic fixtures only. No workspace files, account IDs, or prompts in the report.
const {CodexClient}=require('../src/codex');
const {Attachments,codexInput}=require('../src/attachments');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
function bluePNG(){
 const crc=data=>{let c=0xffffffff;for(const byte of data){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const label=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([label,data])));return Buffer.concat([size,label,data,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(128*(128*3+1));for(let y=0;y<128;y++)for(let x=0;x<128;x++)rows[y*385+1+x*3+2]=255;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
async function run(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'remi-attachments-live-')),client=new CodexClient({cwd});
 try{
  const code=crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(path.join(cwd,'note.txt'),`附件校验码：${code}`);fs.writeFileSync(path.join(cwd,'sample.png'),bluePNG());
  const files=new Attachments();await files.add([path.join(cwd,'note.txt'),path.join(cwd,'sample.png')]);
  await client.open(null,{ephemeral:true});
  const prompt='不要调用工具。读取文本附件的校验码，并观察图片的主体颜色。只回复“校验码/颜色”，颜色用中文。';
  const result=await client.turn(prompt,{input:codexInput(prompt,await files.prepare('codex')),onRequest:async()=>undefined});
  assert.equal(result.text.trim(),`${code}/蓝色`);
  const report={date:new Date().toISOString(),ephemeral:true,textAttachmentDecoded:true,imageAttachmentRecognized:true,exactCombinedReply:true};
  fs.writeFileSync(path.join(__dirname,'../evidence/attachments-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{client.dispose();fs.rmSync(cwd,{recursive:true,force:true});}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={bluePNG};
