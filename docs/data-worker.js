'use strict';
// The same Python/SQLite comparison runs inside the browser, off the UI thread.
const runtimeURL=new URL('vendor/pyodide/',self.location.href).href;
let python,manifest,currentLine=null,sequence=Promise.resolve();
function progress(text){postMessage({type:'progress',text});}
async function bytes(path){
 const response=await fetch(new URL(path,self.location.href));
 if(!response.ok)throw new Error('Daten konnten nicht geladen werden: '+response.status+' · '+path);
 return new Uint8Array(await response.arrayBuffer());
}
async function boot(){
 progress('Vergleich wird vorbereitet …');
 const {loadPyodide}=await import(runtimeURL+'pyodide.mjs');
 python=await loadPyodide({indexURL:runtimeURL});
 const modules=['comparison','feature_compare','line_catalog','browser_api'];
 await Promise.all(modules.map(async name=>python.FS.writeFile('/home/pyodide/'+name+'.py',await bytes('python/'+name+'.py'))));
 manifest=JSON.parse(new TextDecoder().decode(await bytes('data/manifest.json')));
 progress('Karten- und Linienübersicht laden …');
 python.FS.writeFile('/map.sqlite.gz',await bytes('data/map.sqlite.gz'));
 python.runPython(`
import sqlite3,json,gzip,sys
sys.path.insert(0,'/home/pyodide')
from pathlib import Path
import browser_api
Path('/map.sqlite').write_bytes(gzip.decompress(Path('/map.sqlite.gz').read_bytes()))
Path('/map.sqlite.gz').unlink()
browser_api.mapdb=sqlite3.connect('/map.sqlite')
browser_api.mapdb.row_factory=sqlite3.Row
browser_api.mapdb.executescript('CREATE TEMP TABLE trips(pattern,stage,line); CREATE TEMP TABLE patterns(id,stage,calls);')
def activate_line():
    if browser_api.linedb is not None:
        browser_api.linedb.close()
        browser_api.mapdb.executescript('DROP VIEW trips; DROP VIEW patterns; DETACH DATABASE line_data;')
    else:
        browser_api.mapdb.executescript('DROP TABLE trips; DROP TABLE patterns;')
    Path('/line.sqlite').write_bytes(gzip.decompress(Path('/line.sqlite.gz').read_bytes()))
    Path('/line.sqlite.gz').unlink()
    browser_api.linedb=sqlite3.connect('/line.sqlite')
    browser_api.linedb.row_factory=sqlite3.Row
    browser_api.mapdb.execute("ATTACH DATABASE '/line.sqlite' AS line_data")
    browser_api.mapdb.executescript('CREATE TEMP VIEW trips AS SELECT * FROM line_data.trips; CREATE TEMP VIEW patterns AS SELECT * FROM line_data.patterns;')
def request_json(path,query):
    browser_api.route='/api/'+path
    return json.dumps(browser_api.api(browser_api.route,json.loads(query)),ensure_ascii=False,separators=(',',':'))
`);
 progress('Bereit');
}
let ready;
async function line(key){
 if(!key||key===currentLine)return;
 const item=manifest.lines[key];if(!item)throw new Error('Keine Fahrplandaten für diese Linie verfügbar.');
 progress('Fahrplandaten der Linie laden …');
 python.FS.writeFile('/line.sqlite.gz',await bytes('data/'+item.file));
 python.runPython('activate_line()');
 currentLine=key;
}
self.onmessage=event=>{
 const {id,path,query}=event.data;
 sequence=sequence.then(async()=>{
  try{
   if(!ready)ready=boot();await ready;
   if(path==='compare')await line(query.key?.[0]);
   if(path==='map')await line(query.line?.[0]);
   python.globals.set('_request_path',path);python.globals.set('_request_query',JSON.stringify(query));
   const result=JSON.parse(python.runPython('request_json(_request_path,_request_query)'));
   if(result.error)throw new Error(result.error);
   postMessage({id,result});
 }catch(error){console.error(error);progress('Laden fehlgeschlagen. Bitte die Seite neu laden.');postMessage({id,error:String(error.message||error)});}
 });
};
