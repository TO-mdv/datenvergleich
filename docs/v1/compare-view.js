'use strict';
function sourceShort(id){return {dino:'DINO',nered_v2:'NeRED V2',info:'INFO+ ZVV',gesamt:'Gesamt 30.10.'}[id]||id;}
function calendarActive(hex,index){return !!(BigInt('0x'+hex)&(1n<<BigInt(363-index)));}
function demoDay(masks,forced=null){
 if(forced)return forced;
 if(state.lastTimetable?.date)return state.lastTimetable.date;
 const union=masks.reduce((a,m)=>a|BigInt('0x'+m),0n);
 for(let i=0;i<364;i++)if(union&(1n<<BigInt(363-i)))return new Date(Date.UTC(2026,11,13+i)).toISOString().slice(0,10);
 return null;
}
function demoLink(jy,masks,forced=null){
 if(!jy)return '<code>Keine SJYID geliefert</code>';
 const day=demoDay(masks,forced);if(!day)return `<code>${esc(jy)}</code><small>Kein gültiger Verkehrstag geliefert</small>`;
 const url='https://opentdatach.github.io/ojp-demo-app/trip?'+new URLSearchParams({lang:'de',ref:jy,day});
 return `<a class="demo-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="OJP Demo-App · PROD · ${esc(day)}"><code class="sjyid">${esc(jy)}</code><small>OJP-Auskunft · ${esc(day)}</small></a>`;
}
function diffSummary(j){return j.differences.map(d=>d.kind==='presence'?'Fahrt fehlt in '+d.stages.map(sourceShort).join(', '):d.kind==='calendar'?'Abweichende Verkehrstage':d.kind==='source_metadata'?'Quellangaben unterscheiden sich: Fahrtnummer, Unternehmercode, Richtung oder Hinweise (siehe Quellblöcke).':d.kind==='feature'?d.label+': Abweichung':'Abweichende Halte, Haltestellennamen oder Zeiten').join('\n')||(j.featureComparison?.some(f=>f.status==='unknown')?'Keine belegte Abweichung; einzelne Merkmale nicht abschliessend vergleichbar.':'Die verglichenen Angaben stimmen überein.');}
function featureValue(value){
 const labels={pickup:'Einstieg',dropoff:'Ausstieg',kind:'Halteart',request:'Bedarfshalt',code:'Code',definition:'Definition',texts:'Texte',names:'Bezeichnungen',de:'Deutsch',fr:'Französisch',it:'Italienisch',en:'Englisch',short:'Kurzbezeichnung',long:'Explizite Langbezeichnung',long_effective:'Verwendete Langbezeichnung',description:'Beschreibung',global_id:'Globale Linien-ID',marker:'Richtungskennung',explicit_text:'Expliziter Richtungstext',source:'Textquelle',class:'Verkehrsmittelklasse',tariff:'Tarif',display:'Anzeige',surcharge:'Zuschlag',flags:'Kennzeichen',properties:'Weitere Eigenschaften',relation:'Beziehung',partner:'Anschlussfahrt',stop1:'Übergang ab',stop2:'Übergang an',attribute:'Attribut'};
 function flatten(v,prefix=''){if(v&&typeof v==='object')return Object.entries(v).flatMap(([k,x])=>flatten(x,prefix?(prefix+' · '+(labels[k]||k)):(labels[k]||k)));return [prefix+': '+(v===null||v===undefined?'nicht geliefert':v===true?'ja':v===false?'nein':String(v))];}
 return flatten(value).map(esc).join('<br>');
}
function featureDetails(j){
 const status={equal:'Identisch',different:'Abweichung',unknown:'Nicht abschliessend prüfbar'};
 return '<h3>Fachlicher Vergleich</h3><p class="small">Inhalte, Halteabschnitte und Gültigkeit an gemeinsamen Verkehrstagen. Lokale Referenznummern werden aufgelöst. Grau bedeutet unklar, nicht identisch. DINO-Hinweise werden auf Deutsch verglichen; zwischen HRDF-Ständen werden alle gelieferten Sprachen geprüft.</p>'+ (j.featureComparison||[]).map(f=>`<details class="feature-detail ${f.status}"><summary>${esc(f.label)} <strong>${status[f.status]}</strong></summary><div class="feature-pairs">${f.pairs.map(p=>`<span class="${p.status}">${esc(sourceShort(p.from))} → ${esc(sourceShort(p.to))}: ${status[p.status]} · ${p.days} gemeinsame Tage</span>`).join('')}</div>${f.sources.map(s=>`<section><h4 style="color:${stage(s.stage).color}">${esc(sourceShort(s.stage))} · ${!s.present?'Fahrt fehlt':s.known?'Angaben verfügbar':'Zuordnung unklar / nicht direkt vergleichbar'}</h4>${s.issues.length?'<p>'+esc(s.issues.join(' · '))+'</p>':''}${s.entries.length?s.entries.map(e=>`<div class="feature-value"><small>Halte ${e.start===null?'?':e.start+1}–${e.end===null?'?':e.end+1} · ${BigInt('0x'+e.days).toString(2).replaceAll('0','').length} Verkehrstage · ${esc(e.origin)} · Quellzeile ${fmt(e.tripSource)}</small><pre>${featureValue(e.value)}</pre></div>`).join(''):'<p>Keine Einträge geliefert bzw. keine direkte Abbildung verfügbar.</p>'}</section>`).join('')}</details>`).join('');
}
function showComparison(j,stopIndex=null){
 const dialog=$('comparison-dialog');
 let content=`<div class="dialog-heading"><div><h2>Fahrtvergleich · ${clock(j.start)}</h2>${demoLink(j.jy,j.sources.map(s=>s.days))}</div><button id="close-comparison" class="secondary">Schliessen</button></div><p class="comparison-summary">${esc(diffSummary(j)).replace(/\n/g,'<br>')}</p>`;
 if(stopIndex!==null){const stop=j.stops[stopIndex];content+=`<h3>${esc(stop[1])}</h3><p class="small">${esc(stop[0])}</p><div class="cell-comparison">`;
 for(const s of j.sources){const vals=j.cells[stopIndex].values.filter(v=>v[0]===s.stage);content+=`<div><strong style="color:${stage(s.stage).color}">${esc(sourceShort(s.stage))}</strong><span>${!s.blocks?'Fahrt nicht vorhanden':vals.map(v=>v[4]===null?'Halt nicht vorhanden':`${esc(v[4])}: ${clock(v[1])} / ${clock(v[2])}${v[3]?' · Steig '+esc(v[3]):''}`).join('<br>')}</span></div>`;}content+='</div>';}
 content+=featureDetails(j);
 content+='<h3>Gültigkeitskalender</h3><p class="small">Grün = Verkehrstag · Grau = kein Verkehr · roter Rahmen = Unterschied zwischen den eingeblendeten Datenständen. Kalender zeigen die ganze Periode, auch bei gewähltem Betriebstag.</p><div class="calendar-months">';
 const start=new Date(Date.UTC(2026,11,13)),end=new Date(Date.UTC(2027,11,11));
 for(let month=new Date(Date.UTC(2026,11,1));month<=end;month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,1))){
  const days=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
  content+=`<section class="calendar-month"><h4>${month.toLocaleDateString('de-CH',{month:'long',year:'numeric',timeZone:'UTC'})}</h4><div class="calendar-scroll"><table class="calendar"><thead><tr><th>Datenstand</th>${Array.from({length:days},(_,i)=>'<th>'+(i+1)+'</th>').join('')}</tr></thead><tbody>`;
  for(const s of j.sources){content+=`<tr><th style="color:${stage(s.stage).color}">${esc(sourceShort(s.stage))}</th>`;for(let day=1;day<=days;day++){
   const date=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),day)),index=Math.round((date-start)/86400000),valid=index>=0&&index<364;
   const statuses=valid?j.sources.map(x=>calendarActive(x.days,index)):[],active=valid&&calendarActive(s.days,index),changed=valid&&new Set(statuses).size>1;
   const label=`${date.toLocaleDateString('de-CH',{timeZone:'UTC'})} · ${sourceShort(s.stage)}: ${!valid?'ausserhalb der Periode':!s.blocks?'Fahrt nicht vorhanden':active?'verkehrt':'verkehrt nicht'}${changed?' · Abweichung: '+j.sources.map((x,i)=>sourceShort(x.stage)+(statuses[i]?' ja':' nein')).join(', '):''}`;
   content+=`<td><button class="calendar-day ${valid?(active?'runs':'off'):'outside'}${changed?' different':''}" title="${esc(label)}" aria-label="${esc(label)}" data-calendar-label="${esc(label)}" data-day="${valid?date.toISOString().slice(0,10):''}">${active?'•':''}</button></td>`;
  }content+='</tr>';}
  content+='</tbody></table></div></section>';
 }
 content+='</div><p id="calendar-day-detail" class="small" aria-live="polite">Kalendertag anklicken für Details.</p><h3>Quellblöcke und weitere Angaben</h3><p class="small">Mehrere Blöcke derselben SJYID werden in einer Spalte zusammengeführt. Blocknummern und Unternehmercodes sind quellenspezifisch. Leere HRDF-Steige bedeuten hier: nicht in die Fahrplantabelle übernommen.</p>';
 for(const s of j.sources){const trips=j.trips.filter(t=>t.stage===s.stage);content+=`<details class="source-details"><summary style="color:${stage(s.stage).color}">${esc(stage(s.stage).label)} · ${s.blocks} Blöcke · ${s.dayCount} Verkehrstage</summary>${trips.map(t=>`<div>Fahrt ${esc(t.nr)} · Unternehmer ${esc(t.go)} · Richtung ${esc(t.direction||'—')} · ${t.dayCount} Tage · ${clock(t.start)}–${clock(t.finish)}<br>SJYID: ${demoLink(t.jy,[t.days])}<br>Quelle: ${t.stage==='dino'?'trip.din':'FPLAN'} Zeile ${fmt(t.source)}${t.notes?'<br>Hinweise: '+esc(t.notes):''}</div>`).join('')||'<p>Fahrt in diesem Datenstand nicht vorhanden.</p>'}</details>`;}
 $('comparison-content').innerHTML=content;$('close-comparison').onclick=()=>dialog.close();
 dialog.querySelectorAll('[data-calendar-label]').forEach(b=>b.onclick=()=>{$('calendar-day-detail').innerHTML=esc(b.dataset.calendarLabel)+(b.dataset.day?'<br>'+demoLink(j.jy,[],b.dataset.day):'');});
 if(!dialog.open)dialog.showModal();
}
async function loadTimetable(){
 if(!state.selected)return;const version=++state.tableVersion;$('timetable').classList.add('busy');
 let data;try{data=await api('compare',{key:state.selected,date:$('all-days').checked?'':$('date').value,direction:$('direction').value,offset:state.offset,limit:state.limit});}finally{if(version===state.tableVersion)$('timetable').classList.remove('busy');}
 if(version!==state.tableVersion)return;state.lastTimetable=data;const host=$('timetable');host.replaceChildren();
 $('paging-text').textContent=data.total?`${fmt(data.offset+1)}–${fmt(Math.min(data.total,data.offset+data.limit))} von ${fmt(data.total)} Fahrten`:'Keine Fahrten';$('prev').disabled=!data.offset;$('next').disabled=data.offset+data.limit>=data.total;
 if(!data.groups.length){host.innerHTML='<div class="empty"><h2>Keine Fahrten in dieser Auswahl</h2><p>Datum, Richtung oder eingeblendete Datenstände ändern.</p></div>';return;}
 for(const group of data.groups){
  const section=document.createElement('section');section.className='route-group';const heading=document.createElement('div');heading.className='route-heading';heading.textContent=`${group.stops[0]?.[1]||'—'} – ${group.stops.at(-1)?.[1]||'—'} · ${group.stops.length} Halte`;section.append(heading);
  const table=document.createElement('table');table.className='schedule-table comparison-table';const thead=document.createElement('thead'),head=document.createElement('tr');head.innerHTML='<th class="stop-head" scope="col">Haltestelle · Ankunft / Abfahrt<br><small>Eine Spalte je Fahrt / SJYID<br>Gelb = Abweichung · Rot = fehlend</small></th>';
  for(const j of group.journeys){const th=document.createElement('th');th.scope='col';th.className=j.differences.length?'changed':'';const button=document.createElement('button');button.className='trip-button comparison-button';button.title=diffSummary(j);button.innerHTML=`<strong>${clock(j.start)}</strong><span class="diff-badge">${j.differences.length?'Abweichungen anzeigen':'Übereinstimmend · Details'}</span>`;button.onclick=()=>showComparison(j);th.append(button);th.insertAdjacentHTML('beforeend',demoLink(j.jy,j.sources.map(s=>s.days)));
   const summary=document.createElement('div');summary.className='source-summaries';for(const s of j.sources){const b=document.createElement('button');b.className='source-calendar'+(!s.blocks?' missing':!s.active?' inactive':'');b.title=`${stage(s.stage).label}: ${s.blocks} Blöcke, ${s.dayCount} Verkehrstage${!s.active?' · am gewählten Tag kein Verkehr':''}. Kalender öffnen.`;b.style.setProperty('--color',stage(s.stage).color);b.textContent=`${sourceShort(s.stage)} · ${s.blocks?s.dayCount+' Tage':'fehlt'}${s.blocks&&!s.active?' · inaktiv':''}`;b.onclick=()=>showComparison(j);summary.append(b);}th.append(summary);head.append(th);}
  thead.append(head);table.append(thead);const body=document.createElement('tbody');
  group.stops.forEach((stop,i)=>{const row=document.createElement('tr'),name=document.createElement('td');name.className='stop';name.textContent=stop[1];name.title=stop[0];row.append(name);
   for(const j of group.journeys){const cell=document.createElement('td'),c=j.cells[i];cell.className='comparison-cell'+(c.changed?' changed':'');let titles=[];
    for(const s of j.sources){const vals=c.values.filter(v=>v[0]===s.stage),v=vals.filter(v=>v[4]!==null);const label=!s.blocks?'Fahrt fehlt':!v.length?'Halt fehlt':[...new Set(v.map(x=>x[1]!=null&&x[2]!=null&&x[1]!==x[2]?clock(x[1])+' / '+clock(x[2]):clock(x[2]??x[1])))].join(' | ');const line=document.createElement('div');line.className='source-time'+(!s.blocks||!v.length?' missing':'')+(!s.active?' inactive':'');line.style.setProperty('--color',stage(s.stage).color);line.innerHTML=`<span>${esc(sourceShort(s.stage))}</span><time>${esc(label)}</time>`;cell.append(line);titles.push(`${sourceShort(s.stage)}: ${label}${v.length?' · '+v.map(x=>x[4]).join(' / '):''}`);}
    cell.title=titles.join('\n');cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',stop[1]+'. '+titles.join('. '));cell.onclick=()=>showComparison(j,i);cell.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showComparison(j,i);}};row.append(cell);
   }body.append(row);
  });table.append(body);section.append(table);host.append(section);
 }
}
function initResize(){
 const workspace=document.querySelector('.workspace'),main=document.querySelector('main');
 function save(key,value){try{localStorage.setItem(key,value);}catch{}}
 function bind(id,axis,apply){const h=$(id),getAxis=()=>typeof axis==='function'?axis():axis;h.onpointerdown=e=>{h.setPointerCapture(e.pointerId);h.classList.add('dragging');e.preventDefault();};h.onpointermove=e=>{if(h.hasPointerCapture(e.pointerId))apply(getAxis()==='x'?e.clientX:e.clientY);};h.onpointerup=e=>{if(h.hasPointerCapture(e.pointerId))h.releasePointerCapture(e.pointerId);h.classList.remove('dragging');};h.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const r=h.getBoundingClientRect();apply((getAxis()==='x'?r.x:r.y)+(['ArrowLeft','ArrowUp'].includes(e.key)?-24:24));}};}
 const sidebar=x=>{if(innerWidth<=650){workspace.style.setProperty('--sidebar-height',Math.max(120,Math.min(innerHeight-150,x))+'px');}else{const width=Math.max(220,Math.min(innerWidth*.55,x));workspace.style.setProperty('--sidebar-width',width+'px');save('zvv-sidebar-width',width);}map.invalidateSize();};
 const split=x=>{const r=main.getBoundingClientRect(),width=Math.max(160,Math.min(r.width-210,x-r.left));main.style.setProperty('--map-width',width+'px');save('zvv-map-width',width);map.invalidateSize();};
 const controls=y=>{const top=$('control-panel').getBoundingClientRect().top,height=Math.max(90,Math.min(innerHeight*.25,y-top));workspace.style.setProperty('--control-height',height+'px');save('zvv-control-height',height);};
 bind('sidebar-resizer',()=>innerWidth<=650?'y':'x',sidebar);bind('schedule-resizer','x',split);bind('controls-resizer','y',controls);
 try{if(innerWidth>650){const width=Number(localStorage.getItem('zvv-sidebar-width'));if(width)sidebar(width);const splitWidth=Number(localStorage.getItem('zvv-map-width'));if(splitWidth)split(main.getBoundingClientRect().left+splitWidth);}const height=Number(localStorage.getItem('zvv-control-height'));if(height)controls($('control-panel').getBoundingClientRect().top+height);}catch{}
 new ResizeObserver(()=>map.invalidateSize()).observe(main);
}
