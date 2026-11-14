'use strict';
function fixture({keys=7,holds=false,count=240,step=83,id=12345,title='Test chart',offset=0,chords=1}={}){
  const notes=[];
  for(let i=0;i<count;i++)for(let j=0;j<chords;j++){
    const t=1000+i*step+offset,col=(i+j*2)%keys,x=Math.floor((col+.5)*512/keys);
    notes.push(`${x},192,${t},${holds&&i%3===0?'128,0,'+(t+190)+':0:0:0:':'1,0,0:0:0:0:'}`);
  }
  return `osu file format v14\n[General]\nMode:3\n[Metadata]\nTitle:${title}\nArtist:SPM Box\nCreator:Ist1na\nVersion:${keys}K ${holds?'LN':'RC'}\nBeatmapID:${id}\nBeatmapSetID:1234\n[Difficulty]\nCircleSize:${keys}\nOverallDifficulty:8\n[TimingPoints]\n0,500,4,2,1,100,1,0\n[HitObjects]\n`+notes.join('\n');
}
module.exports={fixture};
