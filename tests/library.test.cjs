'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Library}=require('../src/core/library.cjs');
const {fixture}=require('./fixtures.cjs');
const {ENGINE_VERSION}=require('../src/core/catalog.cjs');
test('cold analysis, persistent warm hits, edited/deleted files and option-specific invalidation',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const songs=path.join(root,'Songs');await fs.mkdir(songs);const data=path.join(root,'cache');
  const a=path.join(songs,'a.osu'),b=path.join(songs,'b.OSU');
  await fs.writeFile(a,fixture());await fs.writeFile(b,fixture({keys:4}));
  const lib=new Library(data),opts={model:'detail',rate:1,workers:2};
  const cold=await lib.scan(songs,opts);assert.equal(cold.hits,0);assert.equal(cold.rows.length,2);
  const restored=new Library(data);await restored.load();assert.deepEqual(restored.rows,lib.rows);
  const warm=await restored.scan(songs,opts);assert.equal(warm.hits,2);assert.equal(warm.analysed,0);assert.deepEqual(warm.rows.slice().sort((a,b)=>a.file.localeCompare(b.file)),cold.rows.slice().sort((a,b)=>a.file.localeCompare(b.file)));
  const stat=await fs.stat(a);await fs.writeFile(a,fixture({title:'Edit chart'}));await fs.utimes(a,stat.atime,stat.mtime);
  const edited=await restored.scan(songs,opts);assert.equal(edited.hits,1);assert.equal(edited.analysed,1);assert.equal(edited.rows.find(r=>r.keys===7).title,'Edit chart');
  await fs.rm(b);const removed=await restored.scan(songs,opts);assert.equal(removed.rows.length,1);
  const modded=await restored.scan(songs,{...opts,rate:1.5});assert.equal(modded.hits,0);assert.notEqual(modded.rows[0].rating,removed.rows[0].rating);
  const reverted=await restored.scan(songs,opts);assert.equal(reverted.hits,1);
});
test('cancel retains prior complete library; errors and unsupported charts reported; corrupt journal line tolerated',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-cancel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const songs=path.join(root,'Songs'),data=path.join(root,'data');await fs.mkdir(songs);await fs.mkdir(data);
  await fs.writeFile(path.join(songs,'a.osu'),fixture());
  const lib=new Library(data),opts={model:'detail',rate:1,workers:1};await lib.scan(songs,opts);
  await fs.writeFile(path.join(songs,'broken.osu'),fixture({count:0}));await fs.writeFile(path.join(songs,'skip.osu'),fixture({keys:5}));
  await fs.appendFile(path.join(data,'analysis-cache.ndjson'),'{interrupted\n');
  const report=await lib.scan(songs,opts);assert.equal(report.errors.length,1);assert.equal(report.skipped,1);assert.equal(report.rows.length,1);
  const before=lib.rows;
  for(let i=0;i<6;i++)await fs.writeFile(path.join(songs,`new${i}.osu`),fixture({holds:true,count:500}));
  const pending=lib.scan(songs,opts,()=>lib.cancel());const cancelled=await pending;
  assert.equal(cancelled.complete,false);assert.equal(lib.rows,before);
});
test('old cache schema is reanalysed to obtain the classifier family instead of guessing from rating',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-family-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const songs=path.join(root,'Songs'),data=path.join(root,'data');await fs.mkdir(songs);await fs.writeFile(path.join(songs,'a.osu'),fixture());
  const lib=new Library(data),opts={model:'detail',rate:1,workers:1};await lib.scan(songs,opts);
  const oldVersion=ENGINE_VERSION.replace('adapter-3','adapter-2');
  for(const file of ['analysis-cache.ndjson','library.json']){const target=path.join(data,file);await fs.writeFile(target,(await fs.readFile(target,'utf8')).replaceAll(ENGINE_VERSION,oldVersion));}
  const upgraded=new Library(data);await upgraded.load();assert.equal(upgraded.rows.length,0);
  const result=await upgraded.scan(songs,opts);assert.equal(result.hits,0);assert.equal(result.rows[0].classificationFamily,'RC');
});
