const $ = id => document.getElementById(id);
const languages = [['de','Deutsch'],['en','Englisch']];
const state = {profile:'deployed',caseIndex:2,step:1,all:false};
let data;
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function profile(){return data.profiles.find(x=>x.key===state.profile)||data.profiles[0];}
function currentCase(){return data.cases[state.caseIndex];}
function prefixes(){return Array.from(currentCase().input,(_,i)=>Array.from(currentCase().input).slice(0,i+1).join(''));}
function name(id){return data.names[id]||id;}
function expectedIds(c,prefix){const r=c.rules;return (r.prefix_first_ids||{})[prefix.toLowerCase()]||(prefix===c.input&&r.first_id?[r.first_id]:[]);}
function evaluate(record,c,prefix){
  const issues=[];const hits=record.hits;const ids=hits.map(x=>x.id);const r=c.rules;
  if(record.errors.length)issues.push('Fehler der Suche: '+record.errors.join(', '));
  if(!hits.length)issues.push('Keine Treffer');
  const leading=expectedIds(c,prefix);
  if(leading.length&&JSON.stringify(ids.slice(0,leading.length))!==JSON.stringify(leading))issues.push('Erwartete erste Treffer: '+leading.map(name).join(' · '));
  if(prefix===c.input){
    for(const id of r.required_ids||[])if(!ids.includes(id))issues.push('Erwarteter Halt fehlt: '+name(id));
    for(const [a,b] of r.before||[])if(!ids.includes(a)||!ids.includes(b)||ids.indexOf(a)>=ids.indexOf(b))issues.push(name(a)+' soll vor '+name(b)+' stehen');
    if(r.swiss_before_foreign){let foreign=false;if(hits.some(x=>{if(!x.ch)foreign=true;return x.ch&&foreign;}))issues.push('CH-Haltestellen stehen nicht durchgehend vor Nicht-CH');}
    if(r.swiss_first_at_equal_quality){const foreign=new Set();if(hits.some(x=>{if(!x.ch)foreign.add(x.quality);return x.ch&&foreign.has(x.quality);}))issues.push('Bei gleicher Qualität steht Nicht-CH vor CH');}
  }
  return {issues,leading,hasExpectation:leading.length>0||prefix===c.input};
}
function localTime(utc){return new Intl.DateTimeFormat('de-CH',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Zurich'}).format(new Date(utc));}
function renderLanguage(lang,label,prefix){
  const run=profile().languages[lang];const pair=run.steps[currentCase().name][prefix];const record=pair.OJP;
  const evaluation=evaluate(record,currentCase(),prefix);const section=node('section',undefined,'language');section.setAttribute('aria-labelledby','heading-'+lang);
  const heading=node('div',undefined,'language-heading');const title=node('div',undefined,'language-name');title.append(node('span',lang.toUpperCase(),'language-code'));
  const h=node('h2',label);h.id='heading-'+lang;title.append(h,node('span','«'+prefix+'»','language-input'));heading.append(title);
  const status=node('span',evaluation.issues.length?'Prüfung nicht bestanden':evaluation.hasExpectation?'Ziel erfüllt':'Treffer vorhanden','status '+(evaluation.issues.length?'fail':evaluation.hasExpectation?'pass':'neutral'));heading.append(status);
  const count=node('p',record.hits.length+' Treffer · '+Math.min(state.all?record.hits.length:20,record.hits.length)+' angezeigt','counts');heading.append(count);section.append(heading);
  const efaOrder=pair.EFA.hits.map(x=>x.id),ojpOrder=record.hits.map(x=>x.id);
  const same=JSON.stringify(efaOrder)===JSON.stringify(ojpOrder);
  const meta=node('div',undefined,'language-meta');meta.append(node('span','OJP 2.0 · angefordert: '+lang),node('span','EFA-Reihenfolge: '+(same?'identisch':'abweichend')),node('span',localTime(run.utc)+' Uhr'));section.append(meta);
  if(evaluation.leading.length)section.append(node('p','Erwartet: '+evaluation.leading.map(name).join(' · '),'expectation'));
  if(evaluation.issues.length){const list=node('ul',undefined,'issues');for(const issue of evaluation.issues)list.append(node('li',issue));section.append(list);}
  const rh=node('div',undefined,'result-head');rh.append(node('span','Rang · Land · Haltestelle'),node('span','Qualität'));section.append(rh);
  const hits=record.hits.slice(0,state.all?record.hits.length:20);const list=node('ol',undefined,'results'+(state.all?' all':''));list.setAttribute('aria-label',label+': Treffer für '+prefix);
  for(let i=0;i<hits.length;i++){
    const hit=hits[i];const li=node('li',undefined,'result');const details=node('details',undefined,'stop-details');const summary=node('summary',undefined,'hit');
    summary.append(node('span',String(i+1),'rank'),node('span',hit.ch?'CH':'Nicht-CH','country'+(hit.ch?' ch':'')),node('span',hit.name,'stop-name'),node('span',String(hit.quality??'–'),'quality'));
    const efaRank=pair.EFA.hits.findIndex(x=>x.id===hit.id)+1;
    details.append(summary,node('p',hit.id+' · EFA-Rang: '+(efaRank||'nicht enthalten'),'stop-detail-text'));li.append(details);list.append(li);
  }
  section.append(hits.length?list:node('p','Für diesen Eingabeschritt wurden keine Haltestellen geliefert.','empty'));return section;
}
function render(){
  const ps=prefixes();state.step=Math.max(0,Math.min(state.step,ps.length-1));const prefix=ps[state.step];
  $('case').value=String(state.caseIndex);$('profile').value=state.profile;$('all').checked=state.all;
  $('step').replaceChildren(...ps.map((p,i)=>{const o=node('option',p+' · '+(i+1)+'/'+ps.length);o.value=String(i);return o;}));$('step').value=String(state.step);
  $('selection').textContent='Eingabe «'+prefix+'» · Testfall '+(state.caseIndex+1)+'/'+data.cases.length+' · Schritt '+(state.step+1)+'/'+ps.length;
  $('previous-case').disabled=state.caseIndex===0;$('next-case').disabled=state.caseIndex===data.cases.length-1;
  $('previous-step').disabled=state.step===0;$('next-step').disabled=state.step===ps.length-1;
  $('languages').replaceChildren(...languages.map(([lang,label])=>renderLanguage(lang,label,prefix)));
  $('summary').replaceChildren(...languages.map(([lang,label])=>{const run=profile().languages[lang];const line=node('div',undefined,'summary-line');line.append(node('strong',lang.toUpperCase()),node('p','268/268 EFA/OJP-Antworten · '+run.originalFailures+' Fehlprüfungen. LIR Finetuning: 47/47 Antworten · '+run.finetuningFailures+' Fehlprüfungen.'));return line;}));$('summary').className='summary-grid';
  $('provenance').textContent='Config-Commit '+data.configCommit.slice(0,8)+' · DEV-Deployment #'+data.deploymentTask+' · angezeigter SYS '+profile().languages.de.sys.join(', ')+' · Zeitangaben Europe/Zurich.';
  const url=new URL(location.href);url.searchParams.set('case',currentCase().name);url.searchParams.set('step',String(state.step+1));url.searchParams.set('run',state.profile);if(state.all)url.searchParams.set('all','1');else url.searchParams.delete('all');history.replaceState(null,'',url);
}
function move(axis,delta){if(axis==='case'){const index=Math.max(0,Math.min(data.cases.length-1,state.caseIndex+delta));if(index===state.caseIndex)return;state.caseIndex=index;state.step=0;}else state.step=Math.max(0,Math.min(prefixes().length-1,state.step+delta));render();}
async function start(){
  const response=await fetch('data.json',{cache:'no-store'});if(!response.ok)throw new Error('Testergebnisse konnten nicht geladen werden ('+response.status+').');data=await response.json();
  if(data.format==='packed-stop-rankings-v1')for(const profile of data.profiles)for(const run of Object.values(profile.languages))for(const steps of Object.values(run.steps))for(const pair of Object.values(steps)){
    pair.OJP.hits=pair.OJP.hits.map(([index,quality,ch])=>({...data.stops[index],quality,ch:Boolean(ch)}));
    pair.EFA.hits=pair.EFA.order.map(index=>({id:data.stops[index].id}));
  }
  for(const p of data.profiles){const o=node('option',p.label);o.value=p.key;$('profile').append(o);}
  data.cases.forEach((c,i)=>{const o=node('option',c.name);o.value=String(i);$('case').append(o);});
  const query=new URL(location.href).searchParams;const ci=data.cases.findIndex(x=>x.name===query.get('case'));if(ci>=0)state.caseIndex=ci;
  const step=Number(query.get('step'));if(Number.isInteger(step)&&step>0)state.step=step-1;if(data.profiles.some(x=>x.key===query.get('run')))state.profile=query.get('run');state.all=query.get('all')==='1';
  $('case').addEventListener('change',()=>{state.caseIndex=Number($('case').value);state.step=0;render();});
  $('profile').addEventListener('change',()=>{state.profile=$('profile').value;render();});$('step').addEventListener('change',()=>{state.step=Number($('step').value);render();});$('all').addEventListener('change',()=>{state.all=$('all').checked;render();});
  for(const [id,axis,delta] of [['previous-case','case',-1],['next-case','case',1],['previous-step','step',-1],['next-step','step',1]])$(id).addEventListener('click',()=>move(axis,delta));
  document.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.target.isContentEditable||['TEXTAREA','INPUT'].includes(e.target.tagName))return;const keys={ArrowUp:['step',-1],ArrowDown:['step',1],ArrowLeft:['case',-1],ArrowRight:['case',1]};if(keys[e.key]){e.preventDefault();move(...keys[e.key]);}});
  const c=data.configuration;const info=node('ul');for(const text of ['Sortierung: '+c.sorter,'Klammerzusätze nicht bewerten; Namensabdeckung: '+c.findSearchTermRatio+'; Teilwort-Abzug: '+c.partialWordPenalty,'Suchkandidaten: '+c.candidateLimit,'Relevanz: '+Object.entries(c.relevance).map(([name,value])=>name+' '+value).join(' · '),'Bekannte Abweichungen des geprüften Profils: Stein und Berlingen bei «Berlin». Bei «Mu» erscheint Muri bei Bern unter einer anderen Namensvariante.'])info.append(node('li',text));$('configuration').append(info);
  $('provenance').textContent='Config-Commit '+data.configCommit.slice(0,8)+' · DEV-Deployment #'+data.deploymentTask+' · SYS '+profile().languages.de.sys.join(', ')+' · Zeitangaben Europe/Zurich.';
  $('loading').hidden=true;render();
}
start().catch(error=>{$('loading').textContent=error.message;$('loading').className='error';});
