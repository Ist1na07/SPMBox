'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicWrite,readJson}=require('./storage.cjs');

// osu!stable collection.db: i32 version, i32 count, osu-string name,
// i32 number of maps, then osu-string MD5s. No extensible metadata field exists.
function decode(buffer) {
  if(buffer.length>256*1024*1024)throw Error('collection.db 超过 256 MiB 安全上限');
  let offset=0;
  const integer=()=>{if(offset+4>buffer.length)throw Error('collection.db 已截断');const v=buffer.readInt32LE(offset);offset+=4;return v;};
  const string=()=>{
    if(offset>=buffer.length)throw Error('缺少 osu! 字符串');
    const marker=buffer[offset++];if(marker===0)return '';if(marker!==11)throw Error('无效 osu! 字符串标记');
    let n=0,shift=0,byte;
    do{if(offset>=buffer.length||shift>28)throw Error('无效字符串长度');byte=buffer[offset++];n+=(byte&127)*2**shift;shift+=7;}while(byte&128);
    if(n>buffer.length-offset)throw Error('collection.db 字符串已截断');
    const value=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(offset,offset+n));offset+=n;return value;
  };
  const count=()=>{const n=integer();if(n<0||n>2000000||n>(buffer.length-offset))throw Error('无效收藏夹计数');return n;};
  const version=integer(),n=count(),collections=[];
  for(let i=0;i<n;i++){const name=string(),m=count(),hashes=[];for(let j=0;j<m;j++)hashes.push(string());collections.push({name,hashes});}
  if(offset!==buffer.length)throw Error('collection.db 含未知尾部数据，拒绝覆盖');
  return {version,collections};
}
function encode(db) {
  const chunks=[];
  const integer=v=>{const b=Buffer.alloc(4);b.writeInt32LE(v);chunks.push(b);};
  const string=v=>{const b=Buffer.from(v,'utf8');if(!b.length){chunks.push(Buffer.from([0]));return;}
    let n=b.length;const bytes=[11];do{const low=n&127;n=Math.floor(n/128);bytes.push(low|(n?128:0));}while(n);chunks.push(Buffer.from(bytes),b);};
  integer(db.version);integer(db.collections.length);
  for(const c of db.collections){string(c.name);integer(c.hashes.length);for(const h of c.hashes)string(h);}
  return Buffer.concat(chunks);
}
const sidecar=file=>file+'.spmbox.json';
const sameMembers=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function assertManifest(m,file) {
  if(!m||m.schema!==1||typeof m.owner!=='string'||!Array.isArray(m.entries)||m.database!==path.resolve(file))throw Error('SPM Box 标识文件无效或属于其他数据库，请保留原文件并从备份恢复');
  for(const e of m.entries)if(typeof e.key!=='string'||typeof e.name!=='string'||!Array.isArray(e.hashes)||!e.name.includes(` [SPMBox:v1:${m.owner}:`)||!e.name.endsWith(']'))throw Error('SPM Box 收藏夹记录损坏');
}
async function readState(file) {
  let bytes=null;try{bytes=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  const db=bytes?decode(bytes):{version:20260101,collections:[]};
  const manifest=await readJson(sidecar(file),null);if(manifest)assertManifest(manifest,file);
  return {bytes,db,manifest};
}
function managedState(db,m) {
  return db.collections.map(c=>{
    const entries=m?.entries.filter(e=>e.name===c.name)??[];
    const duplicates=db.collections.filter(x=>x.name===c.name).length;
    const entry=entries.length===1?entries[0]:null;
    const owned=!!entry&&duplicates===1&&sameMembers(c.hashes,entry.hashes);
    return {name:c.name,count:c.hashes.length,managed:owned,modified:!!entry&&!owned,
      foreign:!entry&&c.name.includes('[SPMBox:'),key:owned?entry.key:null};
  });
}
function plan(state,file,groups,scope) {
  const manifest=structuredClone(state.manifest??{schema:1,owner:randomUUID(),database:path.resolve(file),entries:[]});
  const db=structuredClone(state.db),actions=[];
  for(const g of groups){
    if(!g.hashes.every(h=>/^[0-9a-f]{32}$/.test(h)))throw Error('无效谱面 MD5');
    const key=scope+':'+g.tag,entries=manifest.entries.filter(e=>e.key===key);
    if(entries.length>1)throw Error('重复的自动收藏夹记录');
    const entry=entries[0];
    if(entry){
      const matches=db.collections.filter(c=>c.name===entry.name);
      if(matches.length!==1||!sameMembers(matches[0].hashes,entry.hashes))throw Error(`收藏夹已被用户修改或删除，拒绝更新：${entry.name}`);
      matches[0].hashes=[...g.hashes];entry.hashes=[...g.hashes];entry.rule={mode:g.mode,threshold:g.threshold};
      actions.push({type:'update',name:entry.name,count:g.hashes.length});
    }else{
      const id=randomUUID(),name=`SPM Box · 7K · ${g.label} · ${scope} [SPMBox:v1:${manifest.owner}:${id}]`;
      if(db.collections.some(c=>c.name===name))throw Error('收藏夹名称冲突');
      db.collections.push({name,hashes:[...g.hashes]});
      manifest.entries.push({key,name,hashes:[...g.hashes],rule:{mode:g.mode,threshold:g.threshold}});
      actions.push({type:'create',name,count:g.hashes.length});
    }
  }
  return {db,manifest,actions};
}
async function lock(file,action) {
  const lockPath=file+'.spmbox.lock';let handle;
  try{handle=await fs.open(lockPath,'wx');}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    const owner=await readJson(lockPath,{});
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('收藏夹锁文件损坏，请确认没有写入任务后手动移除 '+lockPath);
    try{process.kill(owner.pid,0);throw Error('另一个 SPM Box 正在写入收藏夹');}
    catch(error){if(error.code!=='ESRCH')throw error;}
    await fs.unlink(lockPath);handle=await fs.open(lockPath,'wx');
  }
  try{await handle.writeFile(JSON.stringify({pid:process.pid}));return await action();}
  finally{await handle.close();await fs.unlink(lockPath);}
}
async function currentEquals(file,expected) {
  let now=null;try{now=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  return now===null?expected===null:expected!==null&&now.equals(expected);
}
async function backups(file) {
  const root=path.join(path.dirname(file),'.spmbox-backups');
  try{const entries=await fs.readdir(root,{withFileTypes:true});return entries.filter(e=>e.isDirectory()&&/^\d{4}-.*_[\da-f-]{36}$/.test(e.name)).map(e=>e.name).sort().reverse();}
  catch(e){if(e.code==='ENOENT')return [];throw e;}
}
async function saveSnapshot(file,state) {
  const id=new Date().toISOString().replace(/:/g,'-')+'_'+randomUUID();
  const dir=path.join(path.dirname(file),'.spmbox-backups',id);await fs.mkdir(dir,{recursive:true});
  if(state.bytes)await atomicWrite(path.join(dir,'collection.db'),state.bytes);
  await atomicWrite(path.join(dir,'state.json'),JSON.stringify({schema:1,database:path.resolve(file),existed:state.bytes!==null,manifest:state.manifest}));
  return {id,dir};
}
async function writePair(file,db,manifest) {
  await atomicWrite(file,encode(db));
  await atomicWrite(sidecar(file),JSON.stringify(manifest,null,2));
}
async function rollback(file,state) {
  if(state.bytes===null)await fs.rm(file,{force:true});else await atomicWrite(file,state.bytes);
  if(state.manifest===null)await fs.rm(sidecar(file),{force:true});else await atomicWrite(sidecar(file),JSON.stringify(state.manifest,null,2));
}
// Callers supply the exact buffers/manifest seen in the preview; optimistic
// concurrency is checked again after backups and immediately before replacement.
async function commit(file,expected,change) {
  return lock(file,async()=>{
    if(await readJson(file+'.spmbox.pending.json',null))throw Error('上次写入被中断，请先从备份恢复收藏夹');
    if(!await currentEquals(file,expected.bytes)||JSON.stringify(await readJson(sidecar(file),null))!==JSON.stringify(expected.manifest))throw Error('收藏夹已变化，请重新预览');
    const snapshot=await saveSnapshot(file,expected);
    await atomicWrite(file+'.spmbox.pending.json',JSON.stringify({backup:snapshot.id}));
    try{
      if(!await currentEquals(file,expected.bytes))throw Error('备份时收藏夹已变化，请重新预览');
      await writePair(file,change.db,change.manifest);
    }catch(e){
      // Nothing has been written by us if the optimistic recheck failed.
      if(e.message.startsWith('备份时')){await fs.rm(file+'.spmbox.pending.json',{force:true});throw e;}
      try{await rollback(file,expected);await fs.rm(file+'.spmbox.pending.json',{force:true});}catch{throw Error('写入和自动回滚失败，请关闭 osu! 并从备份恢复：'+snapshot.dir);}
      throw e;
    }
    await fs.rm(file+'.spmbox.pending.json',{force:true});
    return {actions:change.actions,backup:snapshot.dir};
  });
}
async function restore(file,id) {
  if(!(await backups(file)).includes(id))throw Error('无效备份');
  return lock(file,async()=>{
    const dir=path.join(path.dirname(file),'.spmbox-backups',id),meta=await readJson(path.join(dir,'state.json'),null);
    if(meta?.schema!==1||meta.database!==path.resolve(file))throw Error('备份不属于此数据库');
    const state={bytes:meta.existed?await fs.readFile(path.join(dir,'collection.db')):null,manifest:meta.manifest};
    if(state.bytes)decode(state.bytes);if(state.manifest)assertManifest(state.manifest,file);
    // Save current raw bytes even if a crash left the manifest unreadable.
    let current=null;try{current=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    let currentManifest=null;try{currentManifest=await readJson(sidecar(file),null);}catch{/* saved db remains independently recoverable */}
    const snapshot=await saveSnapshot(file,{bytes:current,manifest:currentManifest});
    await atomicWrite(file+'.spmbox.pending.json',JSON.stringify({backup:snapshot.id}));
    await rollback(file,state);await fs.rm(file+'.spmbox.pending.json',{force:true});
    return {backup:snapshot.dir};
  });
}
function removePlan(state,keys) {
  const statuses=managedState(state.db,state.manifest);
  if(!Array.isArray(keys)||!keys.length||keys.some(k=>!statuses.some(s=>s.key===k&&s.managed)))throw Error('只能删除标识完整且未被用户修改的自动收藏夹');
  const names=new Set(state.manifest.entries.filter(e=>keys.includes(e.key)).map(e=>e.name));
  return {db:{...state.db,collections:state.db.collections.filter(c=>!names.has(c.name))},
    manifest:{...state.manifest,entries:state.manifest.entries.filter(e=>!keys.includes(e.key))},
    actions:[...names].map(name=>({type:'delete',name}))};
}
module.exports={decode,encode,readState,managedState,plan,commit,backups,restore,removePlan,sidecar};
