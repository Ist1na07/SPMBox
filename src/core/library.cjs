'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {Worker} = require('node:worker_threads');
const {ENGINE_VERSION,options:validateOptions} = require('./catalog.cjs');
const {atomicWrite} = require('./storage.cjs');
const {compatible,migrate}=require('./cache.cjs');
async function walk(root, signal, visit) {
  const dirs=[root];
  while(dirs.length) {
    if(signal.aborted) return;
    const dir=dirs.pop();
    for (const e of await fs.readdir(dir,{withFileTypes:true})) {
      if(e.isDirectory()) dirs.push(path.join(dir,e.name)); // symlinks deliberately not followed
      else if(e.isFile()&&e.name.toLowerCase().endsWith('.osu')) await visit(path.join(dir,e.name));
    }
  }
}
class Library {
  constructor(dataDir) {this.dataDir=dataDir;this.rows=[];this.report=null;this.running=false;}
  cancel() {this.controller?.abort();}
  async scan(root,input,onProgress=()=>{}, {publish=true,requireClassification=true}={}) {
    if(this.running) throw Error('已有扫描正在进行');
    const opts=validateOptions(input),workers=Math.max(1,Math.min(4,os.availableParallelism()-1,Number(input.workers)||4));
    this.running=true;this.controller=new AbortController();
    const signal=this.controller.signal,start=performance.now();
    const report={total:0,done:0,hits:0,analysed:0,skipped:0,errors:[],warnings:[],workers,complete:false};
    const rows=[],jobs=[],cache=new Map(),archive=new Map(),liveFiles=new Set();
    const cachePath=path.join(this.dataDir,'analysis-cache.ndjson');
    let log, lastEmit=0;
    const emit=force=>{if(force||performance.now()-lastEmit>100){lastEmit=performance.now();onProgress({...report,errors:report.errors.length,warnings:report.warnings.length,elapsedMs:performance.now()-start});}};
    try {
      await fs.mkdir(this.dataDir,{recursive:true});
      try {
        const {createInterface}=require('node:readline');const {createReadStream}=require('node:fs');
        for await(const line of createInterface({input:createReadStream(cachePath),crlfDelay:Infinity})) {
          try {
            const e=JSON.parse(line),tuple=JSON.parse(e.key);
            if(!Array.isArray(tuple)||typeof tuple[0]!=='string'||!Array.isArray(e.signature)||!e.result)continue;
            archive.set(e.version+'|'+e.key,e);if(compatible(e.version))cache.set(e.key,{...e,version:ENGINE_VERSION,result:migrate(e.result)});
          }catch{/* interrupted or invalid journal entry is ignored */}
        }
      } catch(e){if(e.code!=='ENOENT')throw e;}
      await walk(root,signal,async file=>{
        liveFiles.add(file);
        const stat=await fs.stat(file),signature=[stat.size,stat.mtimeMs,stat.ctimeMs];
        const key=JSON.stringify([file,opts.model,opts.rate]);const entry=cache.get(key);
        report.total++;
        if(entry&&(!requireClassification||!entry.result.classificationPending)&&JSON.stringify(entry.signature)===JSON.stringify(signature)) consume(file,entry.result,true,signature);
        else jobs.push({file,key});
        emit();
      });
      log=await fs.open(cachePath,'a');
      let next=0;
      const run=async()=>{
        if(signal.aborted||next>=jobs.length)return;
        const worker=new Worker(path.join(__dirname,'analysis-worker.cjs'));
        const abort=()=>{void worker.terminate();};signal.addEventListener('abort',abort,{once:true});
        try {
          while(!signal.aborted&&next<jobs.length){
            const job=jobs[next++];
            const response=await new Promise((resolve,reject)=>{
              const msg=v=>{cleanup();resolve(v);},err=e=>{cleanup();reject(e);},exit=code=>{cleanup();signal.aborted?resolve(null):reject(Error('分析进程异常退出：'+code));};
              const cleanup=()=>{worker.off('message',msg);worker.off('error',err);worker.off('exit',exit);};
              worker.once('message',msg);worker.once('error',err);worker.once('exit',exit);worker.postMessage({...job,options:opts});
            });
            if(!response||signal.aborted)break;
            consume(job.file,response.result,false,response.signature);
            if(response.signature&&response.result.status!=='error'){
              const entry={version:ENGINE_VERSION,key:job.key,signature:response.signature,result:response.result};cache.set(job.key,entry);
              await log.appendFile(JSON.stringify(entry)+'\n');
            }
            emit();
          }
        }finally {signal.removeEventListener('abort',abort);await worker.terminate();}
      };
      const tasks=Array.from({length:Math.min(workers,jobs.length)},run);
      try{await Promise.all(tasks);}catch(e){this.controller.abort();await Promise.allSettled(tasks);throw e;}
      await log.close();log=null;
      report.complete=!signal.aborted;report.elapsedMs=performance.now()-start;
      // Six valid model/rate variants can exceed 150,000 records in a large library.
      // Never evict live variants merely because another rate was prepared.
      for(const [key,e] of archive)if(compatible(e.version))archive.delete(key);
      const entries=[...archive.values(),...cache.values()].filter(e=>{
        if(signal.aborted)return true;
        const [file]=JSON.parse(e.key),relative=path.relative(root,file);
        const inRoot=!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
        return !inRoot||liveFiles.has(file);
      });
      await atomicWrite(cachePath,entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
      if(report.complete&&publish){
        this.rows=rows;this.root=root;this.options=opts;this.report=report;
        await atomicWrite(path.join(this.dataDir,'library.json'),JSON.stringify({root,options:opts,rows,report,version:ENGINE_VERSION}));
      }
      emit(true);return {...report,rows:report.complete?rows:this.rows};
    }finally {if(log)await log.close();this.running=false;}
    function consume(file,result,hit,signature) {
      report.done++;if(hit)report.hits++;else report.analysed++;
      if(result.status==='ok'){
        rows.push({...result,file,signature});
        if(result.classificationError)report.warnings.push({file,reason:result.classificationError});
      }else if(result.status==='skipped')report.skipped++;
      else report.errors.push({file,reason:result.reason});
    }
  }
  async load() {
    try{const data=JSON.parse(await fs.readFile(path.join(this.dataDir,'library.json'),'utf8'));
      if(compatible(data.version)){Object.assign(this,{rows:data.rows.map(migrate),root:data.root,options:data.options,report:data.report});}
    }catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  }
}
module.exports={Library,walk};
