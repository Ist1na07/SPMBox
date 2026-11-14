'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const c=require('../src/core/collections.cjs');
const {TAGS,COLLECTION_PREFIX,DEFAULT_PRESET_NAME,collectionLabel,collectionName}=require('../src/core/catalog.cjs');
const h='a'.repeat(32),h2='b'.repeat(32),scope='detail-1x';
const group={tag:'speed',mode:'upstream',threshold:25,hashes:[h]};
async function sandbox(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-collections-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return path.join(root,'collection.db');}
function legacy(file,tags=['speed']){
 const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 const entries=tags.map(tag=>({key:scope+':'+tag,name:`!SPM Box · 7K · ${tag} · ${scope} [SPMBox:v1:${owner}:${id}]`,hashes:[h]}));
 return {db:{version:20260101,collections:entries.map(e=>({name:e.name,hashes:e.hashes}))},manifest:{schema:1,owner,database:path.resolve(file),entries}};
}
test('known binary layout and unicode/long ULEB128 names roundtrip',()=>{
 const binary=Buffer.from('01000000010000000b0158010000000b20'+Buffer.from(h).toString('hex'),'hex');
 assert.deepEqual(c.decode(binary),{version:1,collections:[{name:'X',hashes:[h]}]});assert.deepEqual(c.encode(c.decode(binary)),binary);
 const db={version:20260101,collections:[{name:'测试🎵'.repeat(80),hashes:[h,h2]},{name:'',hashes:[]}]};assert.deepEqual(c.decode(c.encode(db)),db);
 for(const bad of [binary.subarray(0,5),Buffer.concat([binary,Buffer.from([0])]),Buffer.from('01000000ffffffff','hex')])assert.throws(()=>c.decode(bad));
});
test('short names, durable sidecar identity, idempotent updates and paired restore',async t=>{
 const file=await sandbox(t),manual={name:'My maps',hashes:[h2]};await fs.writeFile(file,c.encode({version:20250101,collections:[manual]}));
 const initial=await c.readState(file),p=c.plan(initial,file,[group],scope);await c.commit(file,initial,p);
 let now=await c.readState(file);assert.deepEqual(now.db.collections[0],manual);assert.equal(now.db.collections[1].name,'!7K Speed');assert.equal(now.manifest.schema,2);assert.ok(now.manifest.entries[0].id);
 assert.equal(c.managedState(now.db,now.manifest)[0].managed,false);assert.equal(c.managedState(now.db,now.manifest)[1].managed,true);
 const next=c.plan(now,file,[{...group,hashes:[h,h2]}],scope);assert.equal(next.actions[0].type,'update');assert.equal(next.manifest.entries[0].id,now.manifest.entries[0].id);await c.commit(file,now,next);
 now=await c.readState(file);assert.equal(now.db.collections.length,2);assert.equal(now.db.collections[1].hashes.length,2);
 const backups=await c.backups(file);assert.equal(backups.length,2);await c.restore(file,backups.at(-1));now=await c.readState(file);assert.deepEqual(now.db,initial.db);assert.equal(now.manifest,null);
});
test('18 short preset names, no Wildcards or Break; variant suffix only where needed',async t=>{
 const file=await sandbox(t),result=c.plan(await c.readState(file),file,TAGS.map(t=>({...group,tag:t.id})),scope);
 assert.equal(COLLECTION_PREFIX,'!7K ');assert.equal(DEFAULT_PRESET_NAME,'!7K 全部键型');assert.equal(result.db.collections.length,18);
 assert.equal(collectionLabel('density'),'Density');assert.ok(result.db.collections.some(c=>c.name==='!7K Density'));
 assert.ok(result.db.collections.every(c=>c.name.startsWith('!7K ')&&!c.name.includes('[SPMBox:')));
 assert.equal(collectionName('density','compact-1.5x'),'!7K Density Compact DT');assert.equal(collectionName('density','detail-0.75x'),'!7K Density HT');
 for(const tag of ['wildcard','ln wildcard','break'])assert.ok(!TAGS.some(t=>t.id===tag));
});
test('schema1 long names migrate preserving UUID; retired owned classes removed in reviewed plan',async t=>{
 const file=await sandbox(t);const old=legacy(file,['speed','wildcard','ln wildcard','break']);await fs.writeFile(file,c.encode(old.db));await fs.writeFile(c.sidecar(file),JSON.stringify(old.manifest));
 const state=await c.readState(file),p=c.plan(state,file,[group],scope);assert.equal(p.db.collections.length,1);assert.equal(p.db.collections[0].name,'!7K Speed');assert.equal(p.actions.filter(a=>a.type==='delete').length,3);
 assert.equal(p.manifest.entries[0].id,'22222222-2222-4222-8222-222222222222');assert.equal(p.actions[0].previousName,state.db.collections[0].name);
 await c.commit(file,state,p);const now=await c.readState(file);assert.equal(c.managedState(now.db,now.manifest)[0].managed,true);assert.equal(c.plan(now,file,[group],scope).actions[0].previousName,undefined);
});
test('manual edits, duplicates, missing sidecar, name conflicts never get claimed or deleted',async t=>{
 const file=await sandbox(t),initial=await c.readState(file);await c.commit(file,initial,c.plan(initial,file,[group],scope));const state=await c.readState(file);
 const changed=structuredClone(state);changed.db.collections[0].hashes.push(h2);assert.equal(c.managedState(changed.db,changed.manifest)[0].modified,true);assert.throws(()=>c.plan(changed,file,[group],scope),/用户修改/);assert.throws(()=>c.removePlan(changed,[state.manifest.entries[0].key]));
 const copied=structuredClone(state);copied.db.collections.push(copied.db.collections[0]);assert.throws(()=>c.plan(copied,file,[group],scope));
 const lost={...state,manifest:null};assert.throws(()=>c.plan(lost,file,[group],scope),/不属于本工具/);assert.equal(c.managedState(lost.db,null)[0].managed,false);
 const old=legacy(file,['speed','ln wildcard']);old.db.collections[1].hashes=[h2];const retired=c.plan(old,file,[group],scope);assert.equal(retired.db.collections.length,2);assert.equal(retired.actions.some(a=>a.type==='delete'),false);
 const collision=legacy(file);collision.db.collections.push({name:'!7K Speed',hashes:[h2]});assert.throws(()=>c.plan(collision,file,[group],scope),/名称冲突/);
});
test('concurrent external edits, lock and pending transaction block writes',async t=>{
 const file=await sandbox(t),state=await c.readState(file),p=c.plan(state,file,[group],scope);
 await fs.writeFile(file,c.encode({version:1,collections:[{name:'Mine',hashes:[]}]}));await assert.rejects(c.commit(file,state,p),/已变化/);
 const current=await c.readState(file),next=c.plan(current,file,[group],scope);await fs.writeFile(file+'.spmbox.lock',JSON.stringify({pid:process.pid}));await assert.rejects(c.commit(file,current,next),/另一个/);await fs.rm(file+'.spmbox.lock');
 await fs.writeFile(file+'.spmbox.pending.json','{}');await assert.rejects(c.commit(file,current,next),/中断/);
});
test('managed deletion and recovery after interrupted pair commit',async t=>{
 const file=await sandbox(t);await fs.writeFile(file,c.encode({version:1,collections:[{name:'Mine',hashes:[h2]}]}));const initial=await c.readState(file);await c.commit(file,initial,c.plan(initial,file,[group],scope));const state=await c.readState(file),key=state.manifest.entries[0].key;
 await c.commit(file,state,c.removePlan(state,[key]));assert.equal((await c.readState(file)).db.collections.length,1);await fs.writeFile(file+'.spmbox.pending.json','{}');await c.restore(file,(await c.backups(file))[0]);assert.equal((await c.readState(file)).db.collections.length,2);
});
test('sidecar replacement failure rolls back database and retains backup',async t=>{
 const file=await sandbox(t);await fs.writeFile(file,c.encode({version:1,collections:[{name:'Keep',hashes:[h2]}]}));const before=await c.readState(file),change=c.plan(before,file,[group],scope),original=fs.rename;let denied=false;
 fs.rename=async(from,to)=>{if(to===c.sidecar(file)&&!denied){denied=true;throw Error('simulated sidecar failure');}return original(from,to);};
 try{await assert.rejects(c.commit(file,before,change),/simulated/);}finally{fs.rename=original;}
 assert.deepEqual((await c.readState(file)).bytes,before.bytes);assert.equal((await c.readState(file)).manifest,null);assert.equal((await c.backups(file)).length,1);
});
