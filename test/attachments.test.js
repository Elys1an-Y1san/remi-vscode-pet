const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Attachments,codexInput,editorContent}=require('../src/attachments');
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'remi-files-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('selected image and text bytes are snapshotted, named, and sent as typed inputs',()=>fixture(async dir=>{
 const text=path.join(dir,'note.txt'),image=path.join(dir,'drawing.png');
 await fs.writeFile(text,'unique content');const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);await fs.writeFile(image,png);
 const files=new Attachments();await files.add([text,image,text]);assert.equal(files.items.length,2);
 await fs.writeFile(text,'modified later');await fs.writeFile(image,'modified later');
 const selected=await files.prepare('codex'),input=codexInput('Read',selected);
 assert.ok(input[0].text.includes('drawing.png'));assert.ok(input[1].text.includes('unique content'));assert.ok(!input[1].text.includes('modified later'));
 assert.equal(input[2].url,'data:image/png;base64,'+png.toString('base64'));
 files.consume(new Set([selected[0].id]));assert.equal(files.items.length,1);files.remove(selected[1].id);assert.equal(files.items.length,0);
}));
test('binary documents are explicit references and cannot silently go to a text-only provider',()=>fixture(async dir=>{
 const file=path.join(dir,'report.pdf');await fs.writeFile(file,'%PDF-1.4 test');const files=new Attachments();await files.add([file]);
 assert.equal(files.items[0].kind,'reference');await assert.rejects(files.prepare('vscode'),/账号后端/);
 const input=codexInput('Read document',await files.prepare('codex'));assert.ok(input[1].text.includes('尚未读取内容'));assert.ok(input[1].text.includes(file));
 await fs.writeFile(file,'changed');await assert.rejects(files.prepare('codex'),/已更改/);
}));
test('a failed batch is atomic and file count and byte limits are enforced',()=>fixture(async dir=>{
 const files=new Attachments(),small=path.join(dir,'small.txt');await fs.writeFile(small,'a');
 await assert.rejects(files.add([small,dir]),/文件夹/);assert.equal(files.items.length,0);
 const big=path.join(dir,'big.bin');const handle=await fs.open(big,'w');await handle.truncate(16*1024*1024+1);await handle.close();
 await assert.rejects(files.add([small,big]),/16 MB/);assert.equal(files.items.length,0);
 const paths=[];for(let i=0;i<9;i++){const file=path.join(dir,`${i}.txt`);await fs.writeFile(file,'a');paths.push(file);}
 await assert.rejects(files.add(paths),/8 个/);assert.equal(files.items.length,0);
}));
test('editor provider receives binary image parts and text parts',()=>fixture(async dir=>{
 const file=path.join(dir,'note.txt');await fs.writeFile(file,'hello');const files=new Attachments();await files.add([file]);
 const vscode={LanguageModelTextPart:class{constructor(value){this.value=value;}},LanguageModelDataPart:{image:(data,mime)=>({data,mime})}};
 const content=editorContent(vscode,'Question',await files.prepare('vscode'));assert.equal(content.length,2);assert.ok(content[1].value.includes('hello'));
 assert.equal(editorContent(vscode,'Question'),'Question');
}));
