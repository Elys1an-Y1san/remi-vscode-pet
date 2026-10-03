const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Activities}=require('../src/activity');
test('concurrent tasks and pending approvals survive completion/dismissal',async()=>{
 const state=new Activities(); let accepted=0;
 state.update('build',{state:'running',title:'Build'});
 state.update('approval',{state:'waiting',title:'Permission'},{approve:()=>accepted++});
 state.update('other',{state:'review',title:'Finished'});
 assert.equal(state.snapshot().state,'waiting');
 assert.equal(state.dismiss('approval'),false);
 await state.act('approval','approve'); assert.equal(accepted,1);
 state.remove('approval'); assert.equal(state.snapshot().state,'running');
 state.update('build',{state:'failed',title:'Build'});
 assert.equal(state.snapshot().state,'failed');
 state.dismiss('build'); state.dismiss('other'); assert.equal(state.snapshot().state,'idle');
});
test('untrusted action labels never turn into arbitrary commands',async()=>{
 const state=new Activities(); state.update('one',{state:'review',title:'Hi'},{open:()=>{},exec:()=>{throw Error('should not run')}});
 assert.deepEqual(state.snapshot().items[0].actions,['open']);
 assert.throws(()=>state.update('bad',{state:'unknown'}));
 await state.act('one','exec');
 await state.act('missing','open');
});
test('history is bounded without evicting pending work',()=>{
 const state=new Activities(); state.update('pending',{state:'waiting'});
 for(let i=0;i<50;i++) state.update(`done${i}`,{state:'review'});
 assert.equal(state.items.size,21); assert.ok(state.items.has('pending'));
});
