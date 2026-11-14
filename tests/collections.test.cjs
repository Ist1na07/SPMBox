'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const c=require('../src/core/collections.cjs');
const {TAGS,COLLECTION_PREFIX,DEFAULT_PRESET_NAME,collectionLabel}=require('../src/core/catalog.cjs');
const h='a'.repeat(32),h2='b'.repeat(32),scope='detail-1x';
const group={tag:'speed',label:'Speed',mode:'upstream',threshold:25,hashes:[h]};
async function sandbox(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-collections-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return path.join(root,'collection.db');}
test('known binary layout and unicode/long ULEB128 names roundtrip',()=>{
  // Explicit protocol fixture, independent of encoder.
  const binary=Buffer.from('01000000010000000b0158010000000b20'+Buffer.from(h).toString('hex'),'hex');
  assert.deepEqual(c.decode(binary),{version:1,collections:[{name:'X',hashes:[h]}]});
  assert.deepEqual(c.encode(c.decode(binary)),binary);
  const db={version:20260101,collections:[{name:'测试🎵'.repeat(80),hashes:[h,h2]},{name:'',hashes:[]}]};assert.deepEqual(c.decode(c.encode(db)),db);
  for(const bad of [binary.subarray(0,5),Buffer.concat([binary,Buffer.from([0])]),Buffer.from('01000000ffffffff','hex')])assert.throws(()=>c.decode(bad));
});
test('create/update preserve user collections, use durable markers, restore paired backup',async t=>{
  const file=await sandbox(t),manual={name:'!SPM Box · 7K · Speed',hashes:[h2]};
  await fs.writeFile(file,c.encode({version:20250101,collections:[manual]}));
  const initial=await c.readState(file),p=c.plan(initial,file,[group],scope);await c.commit(file,initial,p);
  let now=await c.readState(file);assert.deepEqual(now.db.collections[0],manual);assert.equal(now.db.collections.length,2);
  assert.equal(c.managedState(now.db,now.manifest)[0].managed,false);assert.equal(c.managedState(now.db,now.manifest)[1].managed,true);
  const next=c.plan(now,file,[{...group,hashes:[h,h2]}],scope);assert.equal(next.actions[0].type,'update');await c.commit(file,now,next);
  now=await c.readState(file);assert.equal(now.db.collections.length,2);assert.equal(now.db.collections[1].hashes.length,2);
  const backups=await c.backups(file);assert.equal(backups.length,2);
  await c.restore(file,backups.at(-1));now=await c.readState(file);assert.deepEqual(now.db,initial.db);assert.equal(now.manifest,null);
});
test('every default collection and the preset share the sortable prefix',async t=>{
  const file=await sandbox(t),initial=await c.readState(file);
  const groups=TAGS.map(tag=>({...group,tag:tag.id,label:tag.label}));
  const result=c.plan(initial,file,groups,scope);
  assert.equal(COLLECTION_PREFIX,'!SPM Box · ');
  assert.equal(DEFAULT_PRESET_NAME,'!SPM Box · 全部 7K 键型');
  assert.equal(result.db.collections.length,21);
  assert.equal(collectionLabel('rc'),'RC');assert.equal(collectionLabel('ln'),'LN');assert.equal(collectionLabel('hybrid'),'Hybrid');
  assert.equal(collectionLabel('speed'),'RC · Speed');assert.equal(collectionLabel('coordination'),'LN · Coordination');
  for(const collection of result.db.collections)assert.ok(collection.name.startsWith(COLLECTION_PREFIX+'7K · '));
});
test('flat owned child names acquire their parent without duplicating collections or changing UUIDs',async t=>{
  const file=await sandbox(t),initial=await c.readState(file),old=c.plan(initial,file,[group],scope);
  const original=old.db.collections[0].name.replace(' · RC · Speed · ',' · Speed · ');
  old.db.collections[0].name=original;old.manifest.entries[0].name=original;await c.commit(file,initial,old);
  const state=await c.readState(file),updated=c.plan(state,file,[group],scope);
  assert.equal(updated.db.collections.length,1);assert.equal(updated.actions[0].previousName,original);
  assert.equal(updated.db.collections[0].name,original.replace(' · Speed · ',' · RC · Speed · '));
  await c.commit(file,state,updated);const now=await c.readState(file);
  assert.equal(c.managedState(now.db,now.manifest)[0].managed,true);
  const again=c.plan(now,file,[group],scope);assert.equal(again.actions[0].previousName,undefined);
});
test('verified legacy names migrate once, preserving markers; modified or colliding collections are protected',async t=>{
  const file=await sandbox(t),initial=await c.readState(file),legacy=c.plan(initial,file,[group],scope);
  const legacyName=legacy.db.collections[0].name.slice(1);
  legacy.db.collections[0].name=legacyName;legacy.manifest.entries[0].name=legacyName;
  await c.commit(file,initial,legacy);
  const state=await c.readState(file),updated=c.plan(state,file,[group],scope),name=updated.db.collections[0].name;
  assert.equal(name,'!'+legacyName);assert.equal(updated.actions[0].previousName,legacyName);
  assert.equal(updated.manifest.owner,state.manifest.owner);assert.equal(updated.manifest.entries[0].name,name);
  const edited=structuredClone(state);edited.db.collections[0].hashes.push(h2);
  assert.throws(()=>c.plan(edited,file,[group],scope),/用户修改/);
  const collision=structuredClone(state);collision.db.collections.push({name,hashes:[h2]});
  assert.throws(()=>c.plan(collision,file,[group],scope),/名称冲突/);
  await c.commit(file,state,updated);
  const after=await c.readState(file),again=c.plan(after,file,[group],scope);
  assert.equal(after.db.collections.length,1);assert.equal(c.managedState(after.db,after.manifest)[0].managed,true);
  assert.equal(again.db.collections[0].name,name);assert.equal(again.actions[0].previousName,undefined);
});
test('manual edits, duplicate markers, missing manifest and foreign markers cannot be claimed',async t=>{
  const file=await sandbox(t),initial=await c.readState(file),p=c.plan(initial,file,[group],scope);await c.commit(file,initial,p);
  const state=await c.readState(file),changed=structuredClone(state);changed.db.collections[0].hashes.push(h2);
  assert.equal(c.managedState(changed.db,changed.manifest)[0].modified,true);assert.throws(()=>c.plan(changed,file,[group],scope),/用户修改/);
  const copied=structuredClone(state);copied.db.collections.push(copied.db.collections[0]);assert.throws(()=>c.plan(copied,file,[group],scope));
  assert.throws(()=>c.removePlan(changed,[state.manifest.entries[0].key]));
  const lost={...state,manifest:null},newPlan=c.plan(lost,file,[group],scope);assert.equal(newPlan.db.collections.length,2);assert.notEqual(newPlan.db.collections[0].name,newPlan.db.collections[1].name);
  assert.equal(c.managedState(lost.db,null)[0].managed,false);
});
test('concurrent external edits invalidate a preview; lock and pending transaction block writes',async t=>{
  const file=await sandbox(t),state=await c.readState(file),p=c.plan(state,file,[group],scope);
  await fs.writeFile(file,c.encode({version:1,collections:[{name:'My new collection',hashes:[]}]}));
  await assert.rejects(c.commit(file,state,p),/已变化/);assert.equal((await c.readState(file)).db.collections[0].name,'My new collection');
  const current=await c.readState(file),next=c.plan(current,file,[group],scope);
  await fs.writeFile(file+'.spmbox.lock',JSON.stringify({pid:process.pid}));await assert.rejects(c.commit(file,current,next),/另一个/);await fs.rm(file+'.spmbox.lock');
  await fs.writeFile(file+'.spmbox.pending.json',JSON.stringify({backup:'test'}));await assert.rejects(c.commit(file,current,next),/中断/);
});
test('managed-only deletion and recovery after interrupted pair commit',async t=>{
  const file=await sandbox(t);await fs.writeFile(file,c.encode({version:1,collections:[{name:'Mine',hashes:[h2]}]}));
  const initial=await c.readState(file);await c.commit(file,initial,c.plan(initial,file,[group],scope));
  const state=await c.readState(file),key=state.manifest.entries[0].key;
  await c.commit(file,state,c.removePlan(state,[key]));let now=await c.readState(file);assert.equal(now.db.collections.length,1);assert.equal(now.db.collections[0].name,'Mine');
  await fs.writeFile(file+'.spmbox.pending.json','{"backup":"interrupted"}');
  await c.restore(file,(await c.backups(file))[0]);now=await c.readState(file);assert.equal(now.db.collections.length,2);assert.equal(c.managedState(now.db,now.manifest)[1].managed,true);
});
test('sidecar replacement failure rolls back database and leaves paired recovery snapshot',async t=>{
  const file=await sandbox(t);await fs.writeFile(file,c.encode({version:1,collections:[{name:'Keep',hashes:[h2]}]}));
  const before=await c.readState(file),change=c.plan(before,file,[group],scope);
  const original=fs.rename;let denied=false;
  fs.rename=async(from,to)=>{
    if(to===c.sidecar(file)&&!denied){denied=true;const error=Error('simulated sidecar failure');error.code='EACCES';throw error;}
    return original(from,to);
  };
  try{await assert.rejects(c.commit(file,before,change),/simulated/);}finally{fs.rename=original;}
  const after=await c.readState(file);assert.deepEqual(after.bytes,before.bytes);assert.equal(after.manifest,null);
  assert.equal((await c.backups(file)).length,1);await assert.rejects(fs.stat(file+'.spmbox.pending.json'),{code:'ENOENT'});
});
