'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {Library,walk}=require('../src/core/library.cjs');
const {fixture}=require('../tests/fixtures.cjs');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-benchmark-'));
  try{
    const songs=path.join(temp,'Songs');await fs.mkdir(songs);
    const input=process.argv[2],count=Math.min(500,Math.max(1,Number(process.argv[3])||48));
    if(input){
      const files=[];await walk(path.resolve(input),new AbortController().signal,async file=>files.push({file,size:(await fs.stat(file)).size}));
      files.sort((a,b)=>a.size-b.size);if(!files.length)throw Error('No .osu files');
      const n=Math.min(count,files.length);
      for(let i=0;i<n;i++){const e=files[Math.floor(i*(files.length-1)/Math.max(1,n-1))];await fs.copyFile(e.file,path.join(songs,i+'.osu'));}
    }else for(let i=0;i<count;i++)await fs.writeFile(path.join(songs,i+'.osu'),fixture({keys:[4,6,7][i%3],holds:i%2===0,count:500+i*20,id:i+1}));
    const opts={model:'detail',rate:1};
    const serial=await new Library(path.join(temp,'serial')).scan(songs,{...opts,workers:1});
    const parallel=new Library(path.join(temp,'parallel'));
    const cold=await parallel.scan(songs,{...opts,workers:4}),warm=await parallel.scan(songs,{...opts,workers:4});
    const normalize=r=>r.rows.slice().sort((a,b)=>a.file.localeCompare(b.file));
    assert.deepEqual(normalize(serial),normalize(cold));assert.deepEqual(normalize(cold),normalize(warm));
    assert.equal(warm.analysed,0);assert.equal(warm.hits,warm.total);
    const report={source:input?'local real corpus (size-stratified sample, no maps distributed)':'synthetic fixtures',
      node:process.version,cpu:os.cpus()[0]?.model,logicalCPUs:os.availableParallelism(),charts:cold.total,
      supported:cold.rows.length,errors:cold.errors.length,classificationFailures:cold.warnings.length,
      singleWorkerMs:Math.round(serial.elapsedMs),parallelWorkers:cold.workers,parallelMs:Math.round(cold.elapsedMs),cachedMs:Math.round(warm.elapsedMs),
      parallelSpeedup:Number((serial.elapsedMs/cold.elapsedMs).toFixed(2)),cachedSpeedup:Number((cold.elapsedMs/warm.elapsedMs).toFixed(2)),
      identicalResults:true};
    console.log(JSON.stringify(report,null,2));
  }finally{await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
