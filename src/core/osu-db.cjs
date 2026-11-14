'use strict';
// Byte-preserving stable database editor. Unchanged fields are never re-encoded.
// Layout cross-checked against zzzzv/OsuParsers DatabaseDecoder/DatabaseEncoder.
class Reader {
  constructor(bytes){this.bytes=bytes;this.offset=0;}
  take(n){if(!Number.isSafeInteger(n)||n<0||n>this.bytes.length-this.offset)throw Error('数据库已截断或字段长度无效');const p=this.offset;this.offset+=n;return p;}
  u8(){return this.bytes[this.take(1)];}
  i32(){return this.bytes.readInt32LE(this.take(4));}
  u16(){return this.bytes.readUInt16LE(this.take(2));}
  f32(){return this.bytes.readFloatLE(this.take(4));}
  f64(){return this.bytes.readDoubleLE(this.take(8));}
  i64(){return this.bytes.readBigInt64LE(this.take(8));}
  count(){const n=this.i32();if(n<0||n>2000000||n>this.bytes.length-this.offset)throw Error('数据库计数无效');return n;}
  string(){const marker=this.u8();if(marker===0)return '';if(marker!==11)throw Error('数据库字符串标记无效');let n=0,shift=0,b;
    do{if(shift>28)throw Error('数据库字符串过长');b=this.u8();n+=(b&127)*2**shift;shift+=7;}while(b&128);
    const start=this.take(n);return new TextDecoder('utf-8',{fatal:true}).decode(this.bytes.subarray(start,start+n));}
  stars(){const start=this.offset,n=this.count(),entries=[];
    for(let j=0;j<n;j++){const offset=this.offset;if(this.u8()!==8)throw Error('未知星数键类型，拒绝覆盖');const mods=this.i32(),type=this.u8();
      if(![12,13].includes(type))throw Error('未知星数数值类型，拒绝覆盖');
      entries.push({mods,type,value:type===12?this.f32():this.f64(),start:offset,end:this.offset});}
    if(new Set(entries.map(e=>e.mods)).size!==entries.length)throw Error('重复星数键，拒绝覆盖');
    return {start,end:this.offset,entries};}
}
function decode(bytes){
  const r=new Reader(bytes),version=r.i32();if(version<20140609)throw Error('仅支持 2014-06-09 之后的 osu!stable 数据库');
  r.take(4+1+8);r.string();const count=r.count(),maps=[];
  for(let i=0;i<count;i++){
    const sizeOffset=version<20191106?r.take(4):null,start=r.offset;
    const artist=r.string();r.string();const title=r.string();r.string();const creator=r.string(),difficulty=r.string();r.string();
    const md5=r.string(),filename=r.string();r.take(1+6+8);r.f32();const keys=r.f32();r.take(4+4+8);
    r.stars();r.stars();r.stars();const mania=r.stars();r.take(12);r.take(r.count()*17);
    const beatmapId=r.i32();r.take(8+3);const gradeOffset=r.take(1);r.take(2+4);const mode=r.u8();
    r.string();r.string();r.take(2);r.string();const unplayedOffset=r.take(1),lastPlayedOffset=r.take(8);r.take(1);
    const folder=r.string();r.take(8+5+4+1);
    if(sizeOffset!==null&&bytes.readInt32LE(sizeOffset)!==r.offset-start)throw Error('谱面记录长度不匹配，拒绝覆盖');
    maps.push({artist,title,creator,difficulty,md5,filename,keys,mania,beatmapId,mode,folder,sizeOffset,start,end:r.offset,gradeOffset,unplayedOffset,lastPlayedOffset});
  }
  r.take(4);if(r.offset!==bytes.length)throw Error('osu!.db 含未知尾部数据，拒绝覆盖');
  return {version,maps};
}
function encodeStars(entries,version,original){
  const header=Buffer.alloc(4);header.writeInt32LE(entries.length);return Buffer.concat([header,...entries.map(e=>{
    if(original&&e.start!==undefined&&!e.changed)return original.subarray(e.start,e.end);
    const type=e.type??(version>=20250107?12:13),b=Buffer.alloc(type===12?10:14);b[0]=8;b.writeInt32LE(e.mods,1);b[5]=type;
    if(type===12)b.writeFloatLE(e.value,6);else b.writeDoubleLE(e.value,6);return b;
  })]);
}
function apply(bytes,replacements){
  const chunks=[];let offset=0;
  for(const p of replacements.sort((a,b)=>a.start-b.start)){if(p.start<offset||p.end<p.start||p.end>bytes.length)throw Error('数据库修改区域冲突');chunks.push(bytes.subarray(offset,p.start),p.bytes);offset=p.end;}
  chunks.push(bytes.subarray(offset));return Buffer.concat(chunks);
}
function ratingPlan(bytes,variants){
  const db=decode(bytes),byMap=new Map(),changes=[],replacements=[],matched=new Set();
  for(const row of variants){if(!Number.isFinite(row.rating)||row.rating<0||![1,.75,1.5].includes(row.rate))throw Error('无效 SPM 星数');
    if(!byMap.has(row.md5))byMap.set(row.md5,new Map());byMap.get(row.md5).set(row.rate,row);}
  let maniaMaps=0;
  for(const map of db.maps){if(map.mode!==3||![4,6,7].includes(map.keys))continue;maniaMaps++;
    const ratings=byMap.get(map.md5);if(!ratings)continue;
    const entries=structuredClone(map.mania.entries),updates=[];
    for(const [rate,row] of ratings){if(row.keys!==map.keys)continue;matched.add(row.md5+':'+rate);
      const mods=rate===1?0:rate===.75?256:64;
      for(const mod of rate===1.5?[mods,...(entries.some(e=>e.mods===576)?[576]:[])]:[mods]){
        let entry=entries.find(e=>e.mods===mod),before=entry?.value??null;
        const type=entry?.type??(db.version>=20250107?12:13),after=type===12?Math.fround(row.rating):row.rating;
        if(before===after)continue;
        if(entry){entry.value=after;entry.changed=true;}else entries.push({mods:mod,type,value:after});
        updates.push({mod,before,after,rate});
      }
    }
    if(!updates.length)continue;
    const encoded=encodeStars(entries,db.version,bytes);replacements.push({start:map.mania.start,end:map.mania.end,bytes:encoded});
    if(map.sizeOffset!==null){const size=Buffer.alloc(4);size.writeInt32LE(map.end-map.start+encoded.length-(map.mania.end-map.mania.start));replacements.push({start:map.sizeOffset,end:map.sizeOffset+4,bytes:size});}
    changes.push({title:map.title,difficulty:map.difficulty,beatmapId:map.beatmapId,md5:map.md5,keys:map.keys,updates});
  }
  const output=apply(bytes,replacements);decode(output);
  const available=new Set(variants.map(r=>r.md5+':'+r.rate)).size;
  return {bytes:output,changes,summary:{maps:changes.length,slots:changes.reduce((s,c)=>s+c.updates.length,0),maniaMaps,matched:matched.size,unmatched:available-matched.size}};
}
module.exports={Reader,decode,encodeStars,apply,ratingPlan};
