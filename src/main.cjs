'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {Library}=require('./core/library.cjs');
const {TAGS,ENGINE_VERSION,options:validateOptions,rules:validateRules}=require('./core/catalog.cjs');
const {preview}=require('./core/rules.cjs');
const collections=require('./core/collections.cjs');
const {atomicWrite,readJson}=require('./core/storage.cjs');
const testMode=!app.isPackaged&&process.env.SPMBOX_TEST==='1';
if(testMode&&process.env.SPMBOX_TEST_DATA)app.setPath('userData',process.env.SPMBOX_TEST_DATA);
if(!app.requestSingleInstanceLock())app.quit();
let win,library,settings={},settingsPath,previewToken=null,writing=false;
const html=path.join(__dirname,'ui/index.html'),trusted=pathToFileURL(html).href;
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{
  if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==trusted)throw Error('无效请求来源');
  try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}
});}
const persist=()=>atomicWrite(settingsPath,JSON.stringify(settings,null,2));
function available(){if(library.running)throw Error('请等待分析完成');if(!library.report?.complete||!library.rows.length)throw Error('请先完成谱面分析');}
function file(){if(!settings.osuRoot)throw Error('请先选择 osu!stable 文件夹');return path.join(settings.osuRoot,'collection.db');}
async function gameClosed(){
  if(process.platform!=='win32')return;
  const {stdout}=await promisify(execFile)('tasklist.exe',['/FO','CSV','/NH'],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024});
  if(/^"(?:osu!|osu)\.exe"/mi.test(stdout))throw Error('请先完全退出 osu!，再写入或恢复收藏夹');
}
function assertFreshLibrary(){
  available();if(library.root!==settings.songsRoot)throw Error('目录已变化，请重新分析');
}
function query(input={}){
  const q=typeof input.search==='string'?input.search.slice(0,500).toLowerCase():'';
  const keys=Number(input.keys)||0,tag=typeof input.tag==='string'?input.tag:'';
  const sort=['rating','rcRating','lnRating','title','beatmapId'].includes(input.sort)?input.sort:'rating';
  const direction=input.direction==='asc'?1:-1;
  const list=library.rows.filter(r=>(!keys||r.keys===keys)&&(!tag||r.tags.includes(tag))&&(!q||`${r.artist} ${r.title} ${r.difficulty} ${r.creator} ${r.beatmapId}`.toLowerCase().includes(q)));
  list.sort((a,b)=>{
    const x=a[sort],y=b[sort];if(x==null)return y==null?0:1;if(y==null)return -1;
    return (typeof x==='string'?x.localeCompare(y):x-y)*direction||a.file.localeCompare(b.file);
  });return list;
}
const summary=()=>({count:library.rows.length,keys:[4,6,7].map(k=>({keys:k,count:library.rows.filter(r=>r.keys===k).length})),
  options:library.options??null,root:library.root??null,report:library.report,settings,tags:TAGS,engine:ENGINE_VERSION,version:app.getVersion()});
async function exclusive(action){if(writing||library.running)throw Error('另一项任务正在运行');writing=true;try{return await action();}finally{writing=false;}}
async function selectRoot(){
  if(library.running||writing)throw Error('请先完成当前任务');
  const chosen=await dialog.showOpenDialog(win,{title:'选择 osu!stable 安装目录（或其 Songs 文件夹）',properties:['openDirectory']});
  if(chosen.canceled)return null;return configureRoot(chosen.filePaths[0]);
}
async function configureRoot(root){
  root=await fs.realpath(root);let osuRoot=root,songsRoot;
  if(path.basename(root).toLowerCase()==='songs'){songsRoot=root;osuRoot=path.dirname(root);}
  else{
    songsRoot=path.join(root,'Songs');
    // Respect stable's custom BeatmapDirectory instead of silently scanning the wrong folder.
    const names=await fs.readdir(root);
    for(const name of names.filter(n=>/^osu!.*\.cfg$/i.test(n)).sort()){
      const text=await fs.readFile(path.join(root,name),'utf8');const configured=text.match(/^BeatmapDirectory\s*=\s*(.+)$/mi)?.[1].trim();
      if(configured){songsRoot=path.resolve(root,configured);break;}
    }
  }
  const stat=await fs.stat(songsRoot);if(!stat.isDirectory())throw Error('未找到 Songs 目录');
  songsRoot=await fs.realpath(songsRoot);
  settings={...settings,osuRoot,songsRoot};previewToken=null;await persist();return summary();
}
app.whenReady().then(async()=>{
  const data=app.getPath('userData');await fs.mkdir(data,{recursive:true});settingsPath=path.join(data,'settings.json');
  settings=await readJson(settingsPath,{model:'detail',rate:1,workers:4,rules:TAGS.map(t=>({tag:t.id,mode:'upstream',threshold:t.defaultThreshold}))});
  library=new Library(data);await library.load();
  if(testMode&&process.env.SPMBOX_TEST_ROOT)await configureRoot(process.env.SPMBOX_TEST_ROOT);
  handle('state',()=>summary());
  handle('choose-root',selectRoot);
  handle('settings',async input=>{
    if(library.running||writing)throw Error('请等待当前任务完成');
    const opts=validateOptions(input),workers=Number(input.workers);
    if(!Number.isInteger(workers)||workers<1||workers>8)throw Error('并行数应为 1–8');
    settings={...settings,...opts,workers};previewToken=null;await persist();return summary();
  });
  handle('save-rules',async input=>{settings.rules=validateRules(input);previewToken=null;await persist();});
  handle('scan',async()=>{
    if(writing)throw Error('收藏夹正在写入');if(!settings.songsRoot)throw Error('请先选择 osu!stable 目录');
    previewToken=null;
    const report=await library.scan(settings.songsRoot,settings,p=>{if(!win.isDestroyed())win.webContents.send('progress',p);});
    return {summary:summary(),report};
  });
  handle('cancel',()=>library.cancel());
  handle('query',input=>{
    const list=query(input),page=Math.max(0,Math.floor(Number(input?.page)||0));
    return {total:list.length,rows:list.slice(page*100,(page+1)*100),page};
  });
  handle('preview',async input=>{
    assertFreshLibrary();
    if(library.options.model!==settings.model||library.options.rate!==settings.rate)throw Error('算法或速率已变化，请先重新分析');
    const groups=preview(library.rows,input),dbFile=file(),state=await collections.readState(dbFile);
    const scope=`${library.options.model}-${library.options.rate}x`,change=collections.plan(state,dbFile,groups,scope);
    const token=randomUUID();previewToken={token,state,change,file:dbFile,created:Date.now()};
    return {token,groups:groups.map(({hashes,...g})=>g),actions:change.actions,file:dbFile,
      errors:library.report.errors.length,warnings:library.report.warnings.length};
  });
  handle('write',token=>exclusive(async()=>{
    if(!previewToken||previewToken.token!==token||Date.now()-previewToken.created>600000)throw Error('预览已过期，请重新预览');
    await gameClosed();
    const p=previewToken;previewToken=null;
    return collections.commit(p.file,p.state,p.change);
  }));
  handle('collections',async()=>{
    const target=file(),state=await collections.readState(target);
    return {rows:collections.managedState(state.db,state.manifest),backups:await collections.backups(target),file:target};
  });
  handle('remove',keys=>exclusive(async()=>{
    await gameClosed();previewToken=null;const target=file(),state=await collections.readState(target);
    return collections.commit(target,state,collections.removePlan(state,keys));
  }));
  handle('backups',async()=>({backups:await collections.backups(file()),file:file()}));
  handle('restore',id=>exclusive(async()=>{await gameClosed();previewToken=null;return collections.restore(file(),id);}));
  handle('export',async input=>{
    available();const choice=await dialog.showSaveDialog(win,{title:'导出筛选后的谱面',defaultPath:'SPM-Box.csv',filters:[{name:'CSV',extensions:['csv']}]});
    if(choice.canceled)return null;
    const text=v=>{const s=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';};
    const keys=['beatmapId','artist','title','difficulty','creator','keys','rating','rcRating','lnRating','model','rate','tags','md5'];
    const lines=[keys.join(','),...query(input).map(r=>keys.map(k=>text(Array.isArray(r[k])?r[k].join('; '):r[k])).join(','))];
    await atomicWrite(choice.filePath,'\uFEFF'+lines.join('\r\n'));return choice.filePath;
  });
  handle('reveal-map',async md5=>{const row=library.rows.find(r=>r.md5===md5);if(!row)throw Error('未找到谱面');shell.showItemInFolder(row.file);});
  handle('open-beatmap',async id=>{if(!Number.isSafeInteger(id)||id<=0)throw Error('该谱面尚无在线 ID');await shell.openExternal('https://osu.ppy.sh/beatmaps/'+id);});
  handle('open-data',()=>shell.openPath(data));
  handle('open-backups',async()=>{const root=path.join(path.dirname(file()),'.spmbox-backups');await fs.mkdir(root,{recursive:true});return shell.openPath(root);});
  handle('repository',()=>shell.openExternal('https://github.com/Ist1na07/SPMBox'));
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win=new BrowserWindow({width:1400,height:940,minWidth:1024,minHeight:720,backgroundColor:'#101216',title:'SPM Box',icon:path.join(__dirname,'../assets/icon.png'),
    autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==trusted)event.preventDefault();});
  win.on('close',event=>{if(writing){event.preventDefault();void dialog.showMessageBox(win,{message:'收藏夹正在保存，请稍候再关闭。'});}else library.cancel();});
  await win.loadFile(html);
}).catch(e=>{dialog.showErrorBox('SPM Box 启动失败',e.message);app.quit();});
app.on('second-instance',()=>{win?.show();win?.focus();});
app.on('window-all-closed',()=>app.quit());
