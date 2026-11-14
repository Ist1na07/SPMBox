'use strict';
const {parentPort} = require('node:worker_threads');
const fs = require('node:fs/promises');
const {analyse} = require('./analyse.cjs');
parentPort.on('message', async task=>{
  try {
    const before=await fs.stat(task.file);
    if (before.size>32*1024*1024) throw Error('谱面文件超过 32 MiB 安全上限');
    const buffer=await fs.readFile(task.file);
    const result=analyse(buffer,task.options);
    const after=await fs.stat(task.file);
    if (before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs) throw Error('分析时文件被修改，请重新扫描');
    parentPort.postMessage({result,signature:[after.size,after.mtimeMs,after.ctimeMs]});
  } catch(e) {parentPort.postMessage({result:{status:'error',reason:e.message}});}
});
