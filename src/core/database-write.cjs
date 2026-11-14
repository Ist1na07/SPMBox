'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomicWrite,readJson}=require('./storage.cjs');
const {lock,currentEquals}=require('./collections.cjs');
const {decode}=require('./osu-db.cjs');
const backupRoot=file=>path.join(path.dirname(file),'.spmbox-db-backups');
async function snapshot(file,bytes,label){
  const id=new Date().toISOString().replace(/:/g,'-')+'_'+randomUUID(),dir=path.join(backupRoot(file),id);
  await fs.mkdir(dir,{recursive:true});await atomicWrite(path.join(dir,'osu!.db'),bytes);
  await atomicWrite(path.join(dir,'state.json'),JSON.stringify({schema:1,database:path.resolve(file),label}));return {id,dir};
}
async function commit(file,expected,change,label='SPM 难度重排',beforeReplace=async()=>{}){
  decode(change);
  return lock(file,async()=>{
    if(await readJson(file+'.spmbox.pending.json',null))throw Error('上次数据库写入中断，请先恢复备份');
    if(!await currentEquals(file,expected))throw Error('osu!.db 已变化，请重新预览');
    const backup=await snapshot(file,expected,label);
    await atomicWrite(file+'.spmbox.pending.json',JSON.stringify({backup:backup.id}));
    try{
      await beforeReplace();
      if(!await currentEquals(file,expected)){await fs.rm(file+'.spmbox.pending.json',{force:true});throw Error('备份时 osu!.db 已变化，请重新预览');}
      await atomicWrite(file,change);
    }catch(e){
      // atomicWrite replaces only on success. A failed rename leaves original bytes intact.
      if(await currentEquals(file,expected))await fs.rm(file+'.spmbox.pending.json',{force:true});throw e;
    }
    await fs.rm(file+'.spmbox.pending.json',{force:true});return {backup:backup.dir};
  });
}
async function backups(file){
  let names;try{names=await fs.readdir(backupRoot(file));}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const rows=[];for(const id of names.filter(n=>/^\d{4}-.*_[\da-f-]{36}$/.test(n)).sort().reverse()){
    const meta=await readJson(path.join(backupRoot(file),id,'state.json'),null);if(meta?.database===path.resolve(file))rows.push({id,label:meta.label});
  }return rows;
}
async function restore(file,id,beforeReplace=async()=>{}){
  if(!(await backups(file)).some(e=>e.id===id))throw Error('无效数据库备份');
  const bytes=await fs.readFile(path.join(backupRoot(file),id,'osu!.db'));decode(bytes);
  return lock(file,async()=>{
    const current=await fs.readFile(file),backup=await snapshot(file,current,'恢复前备份');
    await atomicWrite(file+'.spmbox.pending.json',JSON.stringify({backup:backup.id}));
    try{await beforeReplace();if(!await currentEquals(file,current))throw Error('恢复前数据库已变化，请重试');
      await atomicWrite(file,bytes);
    }catch(e){if(await currentEquals(file,current))await fs.rm(file+'.spmbox.pending.json',{force:true});throw e;}
    await fs.rm(file+'.spmbox.pending.json',{force:true});return {backup:backup.dir};
  });
}
module.exports={commit,backups,restore};
