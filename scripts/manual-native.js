// Development fixture. Product default remains editor-scoped.
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const child=spawn(path.join(root,'native/build/RemiOverlay.app/Contents/MacOS/RemiOverlay'),[path.join(root,'assets/remi.png'),path.join(root,'evidence/runtime-native.json')]);
child.stderr.pipe(process.stderr);
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
readline.createInterface({input:child.stdout}).on('line',line=>{
 console.log(line);
 const event=JSON.parse(line);
 if(event.type==='ready')send({type:'config',alwaysVisible:true,focused:true,editorPID:Number(process.argv[2]),offsetX:-500,offsetY:180});
 if(event.type==='chat')send({type:'chat',text:'测试模式：已收到输入，未发送给任何模型。',busy:false});
});
readline.createInterface({input:process.stdin}).on('line',line=>{try{send(JSON.parse(line));}catch{}}).on('close',()=>child.stdin.end());
child.on('exit',()=>process.exit());
