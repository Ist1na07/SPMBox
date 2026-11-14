'use strict';
// Adapted from OsuManiaToolbox RegradeView.cs / Extensions.cs (MIT).
// Copyright (c) 2026 zzzzv; JavaScript adaptation Copyright (c) 2026 Ist1na.
const {Reader,decode,apply}=require('./osu-db.cjs');
const GRADE={X:2,S:3,A:4,B:5,C:6,D:7,N:9};
function decodeScores(bytes){
  const r=new Reader(bytes);r.i32();const maps=r.count(),result=new Map();
  for(let i=0;i<maps;i++){
    const md5=r.string(),n=r.count(),scores=[];
    for(let j=0;j<n;j++){
      const mode=r.u8(),version=r.i32(),hash=r.string();r.string();r.string();
      const n300=r.u16(),n100=r.u16(),n50=r.u16(),geki=r.u16(),katu=r.u16(),miss=r.u16(),points=r.i32();r.take(3);
      const mods=r.i32();r.string();const timestamp=r.i64(),length=r.i32();if(length>0)r.take(length);else if(length< -1)throw Error('未知成绩数据长度');
      if(version>=20140721)r.take(8);else r.take(4);
      if(mods&8388608)r.take(8); // Target Practice extra score data.
      const total=n300+n100+n50+geki+katu+miss,accuracy=total?(300*(geki+n300)+200*katu+100*n100+50*n50)/(300*total)*100:0;
      if(hash!==md5)throw Error('成绩索引与谱面标识不一致');
      if(mode===3)scores.push({accuracy,points,mods,timestamp});
    }
    result.set(md5,[...(result.get(md5)??[]),...scores]);
  }
  if(r.offset!==bytes.length)throw Error('scores.db 含未知数据，停止评级');return result;
}
function settings(input={}){
  const thresholds=input.thresholds??{S:99,A:98,B:96,C:93,D:88};let previous=100;
  for(const g of ['S','A','B','C','D']){const v=Number(thresholds[g]);if(!Number.isFinite(v)||v<0||v>previous)throw Error('评级阈值需满足 100 ≥ S ≥ A ≥ B ≥ C ≥ D ≥ 0');previous=v;}
  const mods={nf:'fixedD',ez:'fixedD',ht:'fixedD',...input.mods};
  if(Object.values(mods).some(v=>!['normal','fixedD','none','ignore'].includes(v)))throw Error('无效 Mod 评级策略');
  const lastPlayed=input.lastPlayed??'keep';if(!['keep','accuracy','score'].includes(lastPlayed))throw Error('无效最近游玩策略');
  return {thresholds,mods,lastPlayed,unplayedIfNoScore:input.unplayedIfNoScore===true};
}
function grade(score,opts){
  for(const [key,mask] of [['nf',1],['ez',2],['ht',256]])if(score.mods&mask){
    if(opts.mods[key]==='fixedD')return GRADE.D;
    if(opts.mods[key]==='none')return GRADE.N;
    if(opts.mods[key]==='ignore')return null;
  }
  if(score.accuracy===100)return GRADE.X;
  for(const g of ['S','A','B','C','D'])if(score.accuracy>=opts.thresholds[g])return GRADE[g];return GRADE.N;
}
function plan(bytes,scoreBytes,input){
  const opts=settings(input),db=decode(bytes),scores=decodeScores(scoreBytes),patches=[],changes=[];
  for(const map of db.maps){if(map.mode!==3)continue;const list=scores.get(map.md5)??[];const updates=[];
    const add=(start,b)=>{if(!bytes.subarray(start,start+b.length).equals(b)){patches.push({start,end:start+b.length,bytes:b});updates.push(start);}};
    const grades=list.map(s=>grade(s,opts)).filter(g=>g!==null);
    if(grades.length)add(map.gradeOffset,Buffer.from([Math.min(...grades)]));
    if(list.length&&opts.lastPlayed!=='keep'){
      const key=opts.lastPlayed==='accuracy'?'accuracy':'points',best=list.reduce((a,b)=>b[key]>a[key]?b:a),b=Buffer.alloc(8);b.writeBigInt64LE(best.timestamp);add(map.lastPlayedOffset,b);
    }else if(!list.length&&opts.unplayedIfNoScore){add(map.unplayedOffset,Buffer.from([1]));add(map.lastPlayedOffset,Buffer.alloc(8));}
    if(updates.length)changes.push({title:map.title,difficulty:map.difficulty,beatmapId:map.beatmapId,md5:map.md5,before:bytes[map.gradeOffset],after:grades.length?Math.min(...grades):bytes[map.gradeOffset],scores:list.length,
      stateChanges:[...(updates.includes(map.lastPlayedOffset)?['更新最近游玩时间']:[]),...(updates.includes(map.unplayedOffset)?['标为未游玩']:[])]});
  }
  const output=apply(bytes,patches);decode(output);return {bytes:output,changes,summary:{maps:changes.length,scores:[...scores.values()].reduce((s,a)=>s+a.length,0)}};
}
module.exports={decodeScores,settings,grade,plan,GRADE};
