'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const channels=['state','choose-root','settings','save-rules','scan','cancel','query','preview','write','collections','remove','backups','restore','export','reveal-map','open-beatmap','open-data','open-backups','repository'];
const api=Object.fromEntries(channels.map(c=>[c,(...args)=>ipcRenderer.invoke(c,...args)]));
api.onProgress=callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('progress',listener);return()=>ipcRenderer.removeListener('progress',listener);};
contextBridge.exposeInMainWorld('spm',api);
