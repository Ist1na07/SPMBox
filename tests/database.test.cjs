'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const db=require('../src/core/osu-db.cjs'),write=require('../src/core/database-write.cjs'),grade=require('../src/core/regrade.cjs');
const {database,scores}=require('./db-fixtures.cjs');
const hash='a'.repeat(32),row={md5:hash,rating:18.123456789,keys:7,rate:1};
test('osu!.db byte-preserving star edits: old entry sizes, double and modern float, NM/HT/DT/NC',()=>{
 for(const version of [20140609,20191105,20191106,20250106,20250107,20260101]){
  const bytes=database([{md5:hash},{md5:'b'.repeat(32),mode:0}],version),original=db.decode(bytes);
  const plan=db.ratingPlan(bytes,[row,{...row,rate:.75,rating:12},{...row,rate:1.5,rating:25},{...row,md5:'c'.repeat(32)}]);
  assert.equal(plan.summary.maps,1);assert.equal(plan.summary.slots,4);assert.equal(plan.summary.unmatched,1);
  const parsed=db.decode(plan.bytes),map=parsed.maps[0],stars=map.mania.entries;
  assert.equal(stars.find(e=>e.mods===0).value,version>=20250107?Math.fround(row.rating):row.rating);
  assert.equal(stars.find(e=>e.mods===2).value,1.25);assert.equal(stars.find(e=>e.mods===64).value,25);assert.equal(stars.find(e=>e.mods===576).value,25);assert.equal(stars.find(e=>e.mods===256).value,12);
  const before=original.maps[0];assert.deepEqual(plan.bytes.subarray(map.start,map.mania.start),bytes.subarray(before.start,before.mania.start));
  assert.deepEqual(plan.bytes.subarray(map.mania.end),bytes.subarray(before.mania.end));assert.deepEqual(db.ratingPlan(plan.bytes,[row,{...row,rate:.75,rating:12},{...row,rate:1.5,rating:25}]).bytes,plan.bytes);
 }
});
test('missing star slots are inserted, unsupported modes/keys and unknown layouts untouched or rejected',()=>{
 const bytes=database([{md5:hash,stars:[]},{md5:'b'.repeat(32),keys:5}]);const plan=db.ratingPlan(bytes,[row,{...row,rate:1.5,rating:25}]);assert.equal(plan.summary.maps,1);assert.equal(db.decode(plan.bytes).maps[0].mania.entries.length,2);
 assert.equal(db.ratingPlan(bytes,[{...row,keys:4}]).summary.maps,0);
 for(const b of [bytes.subarray(0,25),Buffer.concat([bytes,Buffer.from([0])])])assert.throws(()=>db.decode(b));
 const corrupt=Buffer.from(bytes),map=db.decode(bytes).maps[1];corrupt[map.mania.start+4]=99;assert.throws(()=>db.decode(corrupt),/未知星数/);
});
test('database transactions: backup, optimistic conflict, locks, interrupted recovery and failed replacement',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'spmbox-db-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'osu!.db');
 const before=database([{md5:hash}]),change=db.ratingPlan(before,[row]).bytes;await fs.writeFile(file,before);await write.commit(file,before,change);assert.deepEqual(await fs.readFile(file),change);
 const backups=await write.backups(file);assert.equal(backups.length,1);await fs.writeFile(file+'.spmbox.pending.json','{}');await assert.rejects(write.commit(file,change,before),/中断/);await write.restore(file,backups[0].id);assert.deepEqual(await fs.readFile(file),before);
 await assert.rejects(write.commit(file,change,before),/已变化/);await fs.writeFile(file+'.spmbox.lock',JSON.stringify({pid:process.pid}));await assert.rejects(write.commit(file,before,change),/另一个/);await fs.rm(file+'.spmbox.lock');
 const rename=fs.rename;fs.rename=async(from,to)=>{if(to===file)throw Error('simulated locked file');return rename(from,to);};try{await assert.rejects(write.commit(file,before,change),/simulated/);}finally{fs.rename=rename;}
 assert.deepEqual(await fs.readFile(file),before);await assert.rejects(fs.stat(file+'.spmbox.pending.json'),{code:'ENOENT'});
});
test('mania regrade preserves scores, stars and other modes; special mods and played-time policy',()=>{
 const bytes=database([{md5:hash},{md5:'b'.repeat(32),mode:0},{md5:'c'.repeat(32)}]);
 const scoreBytes=scores(hash,[{n300:99,miss:1,mods:0,timestamp:600},{n300:100,miss:1,mods:256,timestamp:700}]);
 const result=grade.plan(bytes,scoreBytes,{lastPlayed:'accuracy',unplayedIfNoScore:true});assert.equal(result.summary.maps,2);const parsed=db.decode(result.bytes),before=db.decode(bytes);
 assert.equal(result.bytes[parsed.maps[0].gradeOffset],grade.GRADE.S);assert.equal(result.bytes.readBigInt64LE(parsed.maps[0].lastPlayedOffset),700n);assert.equal(result.bytes[parsed.maps[2].unplayedOffset],1);
 assert.deepEqual(result.bytes.subarray(parsed.maps[1].start,parsed.maps[1].end),bytes.subarray(before.maps[1].start,before.maps[1].end));
 assert.deepEqual(result.bytes.subarray(parsed.maps[0].mania.start,parsed.maps[0].mania.end),bytes.subarray(before.maps[0].mania.start,before.maps[0].mania.end));
 const settings=grade.settings();assert.equal(grade.grade({accuracy:100,mods:0},settings),2);assert.equal(grade.grade({accuracy:100,mods:1},settings),7);assert.equal(grade.grade({accuracy:99,mods:0},settings),3);
 assert.equal(grade.grade({accuracy:100,mods:1},grade.settings({mods:{nf:'ignore'}})),null);assert.equal(grade.grade({accuracy:100,mods:1},grade.settings({mods:{nf:'none'}})),9);
 assert.throws(()=>grade.settings({thresholds:{S:90,A:99,B:80,C:70,D:60}}),/阈值/);assert.throws(()=>grade.decodeScores(Buffer.concat([scoreBytes,Buffer.from([0])])));
});
