'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
async function atomicWrite(file,content) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try {const h=await fs.open(temp,'wx');try{await h.writeFile(content);await h.sync();}finally{await h.close();}await fs.rename(temp,file);}
  finally {await fs.rm(temp,{force:true});}
}
async function readJson(file,fallback) {
  try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}
}
module.exports={atomicWrite,readJson};
