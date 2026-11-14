'use strict';
// Independent protocol fixture writer: not the production database encoder.
const {createHash}=require('node:crypto');
function writer(){const chunks=[];return {raw:b=>chunks.push(b),byte:v=>chunks.push(Buffer.from([v])),
 int:v=>{const b=Buffer.alloc(4);b.writeInt32LE(v);chunks.push(b);},short:v=>{const b=Buffer.alloc(2);b.writeUInt16LE(v);chunks.push(b);},
 float:v=>{const b=Buffer.alloc(4);b.writeFloatLE(v);chunks.push(b);},double:v=>{const b=Buffer.alloc(8);b.writeDoubleLE(v);chunks.push(b);},
 long:v=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(v));chunks.push(b);},
 string:v=>{if(!v){chunks.push(Buffer.from([0]));return;}const b=Buffer.from(v);let n=b.length,a=[11];do{let x=n&127;n=Math.floor(n/128);a.push(x|(n?128:0));}while(n);chunks.push(Buffer.from(a),b);},bytes:()=>Buffer.concat(chunks)};}
function database(maps,version=20260101){const w=writer();w.int(version);w.int(1);w.byte(1);w.long(0);w.string('Test player');w.int(maps.length);
 for(const [i,map] of maps.entries()){const r=writer();for(const value of ['Artist','艺术家',map.title??'Chart','曲名','Mapper','Test','audio.mp3',map.md5??String(i).repeat(32),map.filename??`chart-${i}.osu`])r.string(value);
 r.byte(4);r.short(300);r.short(0);r.short(0);r.long(123);for(const v of [8,map.keys??7,5,8])r.float(v);r.double(1.4);
 for(let k=0;k<4;k++){const entries=k===3?(map.stars??[[0,2.5],[2,1.25],[64,4.5],[256,1.5],[576,4.5]]):[[0,k+.5]];r.int(entries.length);for(const [mods,value] of entries){r.byte(8);r.int(mods);r.byte(version>=20250107?12:13);if(version>=20250107)r.float(value);else r.double(value);}}
 r.int(60);r.int(65000);r.int(10000);r.int(1);r.double(500);r.double(0);r.byte(1);r.int(map.id??100000+i);r.int(55);r.int(-1);for(const grade of [3,4,5,map.grade??9])r.byte(grade);r.short(0);r.float(.7);r.byte(map.mode??3);r.string('Source');r.string('tags');r.short(0);r.string('');r.byte(0);r.long(100);r.byte(0);r.string(map.folder??'');r.long(0);for(const b of [1,0,1,0,1])r.byte(b);r.int(123456);r.byte(30);
 const entry=r.bytes();if(version<20191106)w.int(entry.length);w.raw(entry);}
 w.int(1);return w.bytes();}
function scores(md5,items=[{accuracy:99,mods:0}]){const w=writer();w.int(20260101);w.int(1);w.string(md5);w.int(items.length);
 for(const item of items){w.byte(3);w.int(20260101);w.string(md5);w.string('Player');w.string('r'.repeat(32));const miss=item.miss??0;w.short(item.n300??99);w.short(0);w.short(0);w.short(0);w.short(0);w.short(miss||1);w.int(item.points??900000);w.short(99);w.byte(0);w.int(item.mods??0);w.string('');w.long(item.timestamp??500);w.int(-1);w.long(5);}return w.bytes();}
module.exports={writer,database,scores,md5:buffer=>createHash('md5').update(buffer).digest('hex')};
