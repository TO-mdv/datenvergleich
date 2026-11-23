'use strict';
const $=id=>document.getElementById(id);
const fmt=n=>Number(n).toLocaleString('de-CH');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={stages:[],enabled:new Set(),selected:null,lineInfo:null,offset:0,limit:48,lineLimit:500,mapVersion:0,tableVersion:0,layers:[],meta:null};
window.viewerState=state;
function stage(id){return state.stages.find(x=>x.id===id)||{label:id,color:'#64748b'};}
function query(extra={}){return new URLSearchParams({stages:[...state.enabled].join(','),...extra}).toString();}
async function api(path,extra={}){return window.staticApi(path,extra);}
function fail(e){$('error').hidden=false;$('error').textContent=e.message||e;setTimeout(()=>$('error').hidden=true,9000);}
let map,renderer,tile;
function scheduleMap(){clearTimeout(scheduleMap.timer);scheduleMap.timer=setTimeout(()=>loadMap().catch(fail),250);}
async function loadMap(){
 const version=++state.mapVersion,b=map.getBounds();$('map-status').textContent='Kartendaten laden …';
 const data=await api('map',{bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(','),zoom:map.getZoom(),line:state.selected||'',only:$('only-selected').checked?'1':'0',stops:$('show-stops').checked?'1':'0',platforms:$('show-platforms').checked?'1':'0'});
 if(version!==state.mapVersion)return;state.lastMap=data;
 state.layers.forEach(x=>map.removeLayer(x));state.layers=[];
 if($('show-lines').checked)for(const g of data.geoms){
  const selected=g.line===state.selected,source=stage(g.stage);const line=L.polyline(g.path,{renderer,color:source.color,weight:selected?5:2.2,opacity:selected?.95:.58,dashArray:g.stage==='gesamt'?'8 5':null,smoothFactor:1.1});
  line.bindTooltip(`<strong>${esc(g.label||g.nered||g.dino||g.line)}</strong><br>${esc(source.label)}<br>${esc(g.nered||g.dino||g.line)}<br>${esc(g.kind)}`,{sticky:true});line.on('click',e=>{L.DomEvent.stopPropagation(e);selectLine(g.line,false).catch(fail);});line.addTo(map);state.layers.push(line);
 }
 function point(p,platform){
  const source=stage(p.stage),pointColor=p.selected?'#dc2626':source.color,marker=L.circleMarker([p.lat,p.lon],{renderer,radius:p.selected?3:platform?2:2.2,color:pointColor,weight:0,fillColor:pointColor,fillOpacity:.95});
  const title=platform?`${p.stop_name||p.stop||''} · Steig ${p.name}`:p.name;
  marker.bindTooltip(`${esc(title)} · ${esc(source.label)}`,{direction:'top'});
  marker.bindPopup(`<div class="popup-source"><i style="width:8px;height:8px;background:${source.color};display:inline-block"></i>${esc(source.label)}</div><div class="popup-title">${esc(title)}</div><div class="popup-row">${platform?'Steig':'Haltestelle'} ${esc(p.id)}</div><div class="popup-id">${esc(p.gid||'Keine globale ID geliefert')}</div><div class="popup-row">${fmt(p.uses)} ${platform?'Steigzuordnungen':'Haltevorkommen'} im Bestand</div>`);marker.addTo(map);state.layers.push(marker);
 }
 const selectedStops=new Map();for(const p of data.selectedStops||[])if(p.lat!=null&&p.lon!=null){const key=p.gid||p.lat+','+p.lon;if(!selectedStops.has(key))selectedStops.set(key,p);}
 data.stops.filter(p=>!selectedStops.has(p.gid||p.lat+','+p.lon)).forEach(p=>point(p,false));data.platforms.forEach(p=>point(p,true));selectedStops.forEach(p=>point(p,false));state.selectedStopCount=selectedStops.size;
 const limited=data.truncatedLines||data.truncated_stops||data.truncated_platforms;
 $('map-status').textContent=`${fmt(data.geoms.length)} Fahrwege · ${fmt(data.stops.length)} zusätzliche Haltestellen · ${fmt(selectedStops.size)} Halte der Linie · ${fmt(data.platforms.length)} Steige${limited?' · Ausschnitt begrenzt: näher zoomen oder Linie wählen':''}${map.getZoom()<15?' · Steige ab Zoom 15':''}`;
}
async function loadLines(){
 const version=state.lineVersion=(state.lineVersion||0)+1;
 const data=await api('lines',{q:$('search').value,limit:state.lineLimit,difference:$('difference-filter').value,sort:$('line-sort').value,comparison:$('comparison-focus').value});
 if(version!==state.lineVersion)return;state.lastCatalogue=data;const host=$('lines');host.replaceChildren();
 $('line-count').textContent=`${fmt(data.lines.length)} von ${fmt(data.total)} Liniengruppen`;$('more-lines').hidden=data.lines.length>=data.total;
 for(const l of data.lines){
  const button=document.createElement('button');button.className='line-item'+(l.key===state.selected?' selected':'');button.dataset.key=l.key;button.setAttribute('role','listitem');
  const isExternal=l.key.startsWith('HRDF:');
  const columns=state.stages.map(s=>{
   const enabled=state.enabled.has(s.id),source=l.source_lines[s.id],count=l.counts[s.id]||0,change=l.comparisons.find(c=>c.after===s.id);
   const percent=change?(change.percent===null?'neu':(change.percent>0?'+':'')+change.percent.toLocaleString('de-CH',{maximumFractionDigits:1})+' %'):'';
   const title=[s.label,source?.assigned?'DIVA-Linie über Fahrtzuordnung ermittelt':'',source?.gos?'Unternehmer: '+source.gos:'',!enabled?'Datenstand ausgeblendet':'',change?`Verglichen mit ${stage(change.before).label}: ${change.delta>0?'+':''}${fmt(change.delta)} Fahrtblöcke`:''].filter(Boolean).join(' · ');
   return `<div class="line-source${!enabled?' disabled-source':''}${enabled&&!source&&!isExternal?' absent-source':''}" style="--color:${s.color}" title="${esc(title)}"><span class="source-public">${source?'Linie '+esc(source.label||l.label):'—'}</span><span class="source-diva">${esc(source?(source.diva||'Keine DIVA-Zuordnung'):'—')}</span><strong class="source-trips">${enabled?fmt(count):'—'}<small> ${enabled?'Fahrten':'ausgeblendet'}</small></strong><span class="source-delta ${change?.delta<0?'decrease':change?.delta>0?'increase':''}">${esc(percent||' ')}</span></div>`;
  }).join('');
  const metric=l.comparisons.length&&l.max_delta?`Max. Differenz ${fmt(l.max_delta)} Blöcke${l.missing?' · Datenstand fehlt':''}`:l.comparisons.length?'Gleiche Anzahl Fahrtblöcke':'Kein vergleichbares Datenpaar';
  button.innerHTML=`<div class="line-title"><span class="line-number">${esc(l.label||'—')}</span><span>${isExternal?'HRDF-Linie':'DIVA-Linie'}</span><span class="line-difference${l.max_delta?' has-difference':''}">${esc(metric)}</span></div><div class="line-source-grid">${columns}</div>`;
  button.onclick=()=>selectLine(l.key,true).catch(fail);host.append(button);
 }
 if(!data.lines.length)host.innerHTML='<div class="empty">Keine Linien für diese Suche und Filter. Für einen Vergleich mindestens zwei passende Datenstände einblenden.</div>';
}
async function selectLine(key,fit){
 state.selected=key;state.offset=0;state.lineInfo=await api('line',{key});const l=state.lineInfo;
 $('selected-label').textContent=`Linie ${l.label||l.nered||l.dino||key}`;$('selected-key').textContent=[l.dino?'DINO '+l.dino:'',l.nered?'NeRED '+l.nered:'',key.startsWith('HRDF:')?'Nationale HRDF-Linie ohne eindeutige DIVA-Zuordnung':''].filter(Boolean).join(' · ');$('zoom-line').disabled=!l.bounds;
 document.querySelectorAll('.line-item').forEach(x=>x.classList.toggle('selected',x.dataset.key===key));$('trip-detail').hidden=true;
 if(fit&&l.bounds)zoomLine();else scheduleMap();await loadTimetable();
}
window.selectLine=selectLine;
function zoomLine(){const b=state.lineInfo?.bounds;if(b)map.fitBounds([[b[0],b[2]],[b[1],b[3]]],{padding:[40,40],maxZoom:16});}
function clock(v){return v==null?'—':String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');}
async function updateStages(){await loadLines();scheduleMap();if(state.selected){state.offset=0;await loadTimetable();}}
async function init(){
 if(location.protocol==='file:')throw Error('Bitte diese Ansicht mit Start.cmd starten und über http://localhost:8877 öffnen.');
 state.meta=await api('meta');state.stages=state.meta.stages;state.stages.forEach(s=>state.enabled.add(s.id));
 for(const s of state.stages){const label=document.createElement('label');label.className='source';label.style.setProperty('--color',s.color);label.innerHTML=`<input type="checkbox" checked value="${s.id}" aria-label="${esc(s.label)} anzeigen"><span class="swatch"></span><span class="source-name" title="${esc(s.label)} · ${fmt(s.total)} Datensätze · ${fmt(s.lines)} Liniengruppen">${esc(sourceShort(s.id))}<span class="source-count">${fmt(s.total)} Datensätze · ${fmt(s.lines)} Liniengruppen</span></span>`;label.querySelector('input').onchange=e=>{if(e.target.checked)state.enabled.add(s.id);else state.enabled.delete(s.id);updateStages().catch(fail);};$('stages').append(label);}
 map=L.map('map',{preferCanvas:true,zoomControl:true}).setView([47.385,8.555],12);window.viewerMap=map;renderer=L.canvas({padding:.5,tolerance:5});
 tile=L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',{maxZoom:20,attribution:'&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);let errors=0;tile.on('tileerror',()=>{if(++errors>3)$('tile-warning').hidden=false;});tile.on('tileload',()=>{$('tile-warning').hidden=true;errors=0;});
 map.on('moveend',scheduleMap);$('home').onclick=()=>map.setView([47.385,8.555],12);$('zoom-line').onclick=zoomLine;
 for(const id of ['show-lines','show-stops','show-platforms','only-selected'])$(id).onchange=scheduleMap;
 for(const id of ['difference-filter','line-sort','comparison-focus'])$(id).onchange=()=>{state.lineLimit=500;loadLines().catch(fail);};
 $('search').oninput=()=>{clearTimeout(init.searchTimer);state.lineLimit=500;init.searchTimer=setTimeout(()=>loadLines().catch(fail),220);};$('more-lines').onclick=()=>{state.lineLimit+=500;loadLines().catch(fail);};
 for(const id of ['date','direction','all-days'])$(id).onchange=()=>{state.offset=0;$('date').disabled=$('all-days').checked;loadTimetable().catch(fail);};
 $('prev').onclick=()=>{state.offset=Math.max(0,state.offset-state.limit);loadTimetable().catch(fail);};$('next').onclick=()=>{state.offset+=state.limit;loadTimetable().catch(fail);};
 initResize();await loadLines();await loadMap();await selectLine('70-12-D',true);window.viewerReady=true;
}
init().catch(fail);
