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
  await fs.appendFile(path.join(data,'analysis-cache.ndjson'),'{interrupted\n{}\n');
  const report=await lib.scan(songs,opts);assert.equal(report.errors.length,1);assert.equal(report.skipped,1);assert.equal(report.rows.length,1);
  const before=lib.rows;
  for(let i=0;i<6;i++)await fs.writeFile(path.join(songs,`new${i}.osu`),fixture({holds:true,count:500}));
  const pending=lib.scan(songs,opts,()=>lib.cancel());const cancelled=await pending;
  assert.equal(cancelled.complete,false);assert.equal(lib.rows,before);
});

test('adapter 1–3 caches migrate without engine calls; exact tag family recovered, Rating ignored',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-migrate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const songs=path.join(root,'Songs'),data=path.join(root,'data');await fs.mkdir(songs);await fs.writeFile(path.join(songs,'a.osu'),fixture());
 const opts={model:'detail',rate:1,workers:1},lib=new Library(data);const original=await lib.scan(songs,opts);
 const journal=JSON.parse((await fs.readFile(path.join(data,'analysis-cache.ndjson'),'utf8')).trim()),snapshot=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));
 for(const adapter of [1,2,3]){
  const e=structuredClone(journal),saved=structuredClone(snapshot);e.version=saved.version=ENGINE_VERSION+'-adapter-'+adapter;
  for(const row of [e.result,...saved.rows]){delete row.classificationFamily;delete row.scores.rc;delete row.scores.ln;row.family='LN';}
  await fs.writeFile(path.join(data,'analysis-cache.ndjson'),JSON.stringify(e)+'\n');await fs.writeFile(path.join(data,'library.json'),JSON.stringify(saved));
  const migrated=new Library(data);await migrated.load();assert.equal(migrated.rows.length,1);assert.equal(migrated.rows[0].classificationFamily,'RC');
  const report=await migrated.scan(songs,opts);assert.equal(report.hits,1);assert.equal(report.analysed,0);assert.equal(report.rows[0].rating,original.rows[0].rating);
 }
});
test('only ambiguous old tagless rows refresh; unrelated algorithm cache is retained',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-targeted-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const songs=path.join(root,'Songs'),data=path.join(root,'data');await fs.mkdir(songs);for(const name of ['a','b'])await fs.writeFile(path.join(songs,name+'.osu'),fixture({title:name}));
 const opts={model:'detail',rate:1,workers:1},lib=new Library(data);await lib.scan(songs,opts);
 const entries=(await fs.readFile(path.join(data,'analysis-cache.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
 for(const e of entries){e.version=ENGINE_VERSION+'-adapter-2';delete e.result.classificationFamily;}entries[0].result.tags=[];
 const foreign={...entries[0],version:'another-algorithm'};await fs.writeFile(path.join(data,'analysis-cache.ndjson'),[...entries,foreign].map(JSON.stringify).join('\n')+'\n');
 const ratingOnly=await lib.scan(songs,opts,()=>{},{publish:false,requireClassification:false});assert.equal(ratingOnly.hits,2);assert.equal(ratingOnly.analysed,0);
 const report=await lib.scan(songs,opts);assert.equal(report.hits,1);assert.equal(report.analysed,1);
 assert.match(await fs.readFile(path.join(data,'analysis-cache.ndjson'),'utf8'),/another-algorithm/);
 const snapshot=await fs.readFile(path.join(data,'library.json'),'utf8');const other=await lib.scan(songs,{...opts,rate:1.5},()=>{},{publish:false});assert.equal(other.complete,true);assert.equal(await fs.readFile(path.join(data,'library.json'),'utf8'),snapshot);
});
