'use strict';
const comparisonWorker=new Worker(new URL('data-worker.js',document.baseURI),{type:'module'});
const requests=new Map();let requestNumber=0;
comparisonWorker.onmessage=({data})=>{
 if(data.type==='progress'){
  const status=document.getElementById('map-status');if(status)status.textContent=data.text;
  return;
 }
 const task=requests.get(data.id);if(!task)return;requests.delete(data.id);
 data.error?task.reject(new Error(data.error)):task.resolve(data.result);
};
comparisonWorker.onerror=event=>{
 for(const task of requests.values())task.reject(new Error(event.message||'Der Vergleich konnte nicht gestartet werden. Bitte die Seite neu laden.'));
 requests.clear();
};
window.staticApi=(path,extra)=>new Promise((resolve,reject)=>{
 const id=++requestNumber,query={stages:[[...state.enabled].join(',')],...Object.fromEntries(Object.entries(extra).map(([key,value])=>[key,[String(value)]]))};
 requests.set(id,{resolve,reject});comparisonWorker.postMessage({id,path,query});
});
