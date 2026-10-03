'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vscode=require('vscode');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn()) return;await wait(100);}throw new Error('Timed out');}
async function run(){
 const extension=vscode.extensions.getExtension('local-remi.remi-companion');assert.ok(extension);
 const api=await extension.activate();await until(()=>api.inspect().ready);
 const native=await vscode.commands.executeCommand('remi.inspect');
 assert.ok(native.native);assert.equal(native.native.frame.width,112);
 const report={nativeReady:true,native:{ownerFound:native.native.ownerFound,visible:native.native.visible,focused:native.native.focused,ownerMatchesForeground:native.native.editorPID===native.native.frontPID,width:native.native.frame.width,height:native.native.frame.height},tests:[]};
 api.updateActivity('a',{title:'Parallel A',state:'running'});
 api.updateActivity('b',{title:'Parallel B',state:'running'});
 api.removeActivity('a');assert.equal(api.inspect().state,'running');api.removeActivity('b');
 report.tests.push('parallel activity lifecycle');
 const task=new vscode.Task({type:'shell'},vscode.TaskScope.Global,'Remi success test','remi',new vscode.ShellExecution('exit 0'));
 await vscode.tasks.executeTask(task);
 await until(()=>api.inspect().items.some(i=>i.title==='Remi success test' && i.state==='review'));
 report.tests.push('real shell task success');
 const bad=new vscode.Task({type:'shell'},vscode.TaskScope.Global,'Remi failure test','remi',new vscode.ShellExecution('exit 7'));
 await vscode.tasks.executeTask(bad);
 await until(()=>api.inspect().items.some(i=>i.title==='Remi failure test' && i.state==='failed' && i.body.includes('7')));
 report.tests.push('real shell task failure exit 7');
 await vscode.workspace.getConfiguration('remi').update('followCursor',false,vscode.ConfigurationTarget.Global);
 await vscode.workspace.getConfiguration('remi').update('reducedMotion',true,vscode.ConfigurationTarget.Global);
 for(const [state,row] of Object.entries({idle:0,'running-right':1,'running-left':2,waving:3,jumping:4,failed:5,waiting:6,running:7,review:8})){
  api.animate(state);await until(async()=>{const read=await vscode.commands.executeCommand('remi.inspect');return read.native?.state===state&&read.native?.row===row;});
 }
 report.tests.push('all nine animation states confirmed by native row readback');
 await vscode.workspace.getConfiguration('remi').update('size',160,vscode.ConfigurationTarget.Global);
 await until(async()=>(await vscode.commands.executeCommand('remi.inspect')).native?.frame.width===160);
 await vscode.workspace.getConfiguration('remi').update('size',112,vscode.ConfigurationTarget.Global);
 await until(async()=>(await vscode.commands.executeCommand('remi.inspect')).native?.frame.width===112);
 report.tests.push('native resize and restore');
 await vscode.commands.executeCommand('remi.hide');assert.equal(api.inspect().visible,false);
 assert.equal((await vscode.commands.executeCommand('remi.inspect')).native.visible,false);
 await vscode.commands.executeCommand('remi.show');assert.equal(api.inspect().visible,true);
 await until(async()=>(await vscode.commands.executeCommand('remi.inspect')).native?.visible===true);
 report.tests.push('show/hide confirmed by native window readback');
 await vscode.workspace.getConfiguration('remi').update('followCursor',undefined,vscode.ConfigurationTarget.Global);
 await vscode.workspace.getConfiguration('remi').update('reducedMotion',undefined,vscode.ConfigurationTarget.Global);
 fs.mkdirSync(path.join(__dirname,'../evidence'),{recursive:true});
 fs.writeFileSync(process.env.REMI_TEST_REPORT || path.join(__dirname,'../evidence/extension-host.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
module.exports={run};
