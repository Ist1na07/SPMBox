'use strict';
const fields=new Set(['keys','rating','rcRating','lnRating','beatmapId','beatmapSetId','notes','duration','bpm','title','artist','creator','difficulty','family','classificationFamily','rate','model']);
// Deliberately no JavaScript eval, member access, assignments or arbitrary calls.
function compile(source=''){
  if(!source.trim())return ()=>true;if(source.length>1500)throw Error('筛选表达式过长');
  const re=/\s*(>=|<=|==|!=|&&|\|\||[()!<>~]|-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|[A-Za-z][A-Za-z0-9]*)/gy,tokens=[];let match,end=0;
  while((match=re.exec(source))){tokens.push(match[1]);end=re.lastIndex;}
  if(source.slice(end).trim())throw Error('筛选表达式含不支持的字符');let i=0;
  const peek=()=>tokens[i],take=()=>tokens[i++];
  function value(){const t=take();if(!t)throw Error('筛选表达式不完整');
    if(t==='('){const v=or();if(take()!==')')throw Error('筛选表达式缺少右括号');return v;}
    if(t==='hasTag'){if(take()!=='(')throw Error('hasTag 需要括号');const tag=take();if(!tag?.startsWith('"')||take()!==')')throw Error('使用 hasTag("density")');const name=JSON.parse(tag);return r=>r.tags?.includes(name);}
    if(t.startsWith('"')){const v=JSON.parse(t);return ()=>v;}
    if(/^-?\d/.test(t)){const v=Number(t);return ()=>v;}
    if(t==='true'||t==='false')return ()=>t==='true';
    if(!fields.has(t))throw Error('未知筛选字段：'+t);return r=>r[t];
  }
  function comparison(){const left=value(),op=peek();if(!['>=','<=','==','!=','>','<','~'].includes(op))return left;take();const right=value();
    return r=>{const a=left(r),b=right(r);if(op==='==')return a===b;if(op==='!=')return a!==b;if(a==null||b==null)return false;
      if(op==='~')return String(a).toLowerCase().includes(String(b).toLowerCase());
      return op==='>='?a>=b:op==='<='?a<=b:op==='>'?a>b:a<b;};}
  function not(){if(peek()==='!'){take();const next=not();return r=>!next(r);}return comparison();}
  function and(){let left=not();while(peek()==='&&'){take();const a=left,b=not();left=r=>a(r)&&b(r);}return left;}
  function or(){let left=and();while(peek()==='||'){take();const a=left,b=and();left=r=>a(r)||b(r);}return left;}
  const predicate=or();if(i!==tokens.length)throw Error('筛选表达式存在多余内容');return r=>!!predicate(r);
}
module.exports={compile};
