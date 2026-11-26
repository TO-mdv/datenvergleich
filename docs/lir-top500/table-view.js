/* Column filters, ordering and visibility for the recorded-results table. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const columns = [
    {key:'group', label:'Gruppe / Rang', width:150},
    {key:'name', label:'Bahnhof / Bedeutung', width:300},
    {key:'d', label:'DEV', width:190},
    {key:'t', label:'TEST', width:190},
    {key:'i', label:'INT', width:190},
    {key:'delta', label:'DEV / TEST', width:200}
  ];
  const fields = ['group','name','d','t','i','delta','d-status','t-status','i-status','delta-status'];
  const storageKey = 'lir-ranking-table-view-v1';
  const presets = ['rank','name','d','t','i','delta','column'];
  const text = v => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('de').trim();
  const defaults = () => ({filters:Object.fromEntries(fields.map(k=>[k,k.endsWith('-status')?'all':''])),
    visible:Object.fromEntries(columns.map(c=>[c.key,true])), sort:{key:'group',direction:'asc'}, preset:'rank'});
  let state = defaults(), hooks;

  function restore() {
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(storageKey) || 'null');
      if (!saved || typeof saved !== 'object') return;
      for (const key of fields) if (typeof saved.filters?.[key] === 'string') state.filters[key]=saved.filters[key].slice(0,100);
      for (const key of ['d-status','t-status','i-status']) if (!['all','hit','miss','not_present','error'].includes(state.filters[key])) state.filters[key]='all';
      if (!['all','better','worse','same','unavailable'].includes(state.filters['delta-status'])) state.filters['delta-status']='all';
      for (const c of columns) if (typeof saved.visible?.[c.key] === 'boolean') state.visible[c.key]=saved.visible[c.key];
      if (!columns.some(c=>state.visible[c.key])) state.visible.name=true;
      if (columns.some(c=>c.key===saved.sort?.key) && ['asc','desc'].includes(saved.sort?.direction)) state.sort={...saved.sort};
      if (presets.includes(saved.preset)) state.preset=saved.preset;
    } catch (_) { /* Storage can be disabled or contain an older, invalid view. */ }
  }
  function persist() {
    try { globalThis.localStorage?.setItem(storageKey,JSON.stringify(state)); } catch (_) { /* View remains usable without storage. */ }
  }
  function activeSort() {
    const preset=$('sort').value;
    if (preset==='column') return state.sort;
    const key={rank:'group',name:'name',d:'d',t:'t',i:'i'}[preset];
    return key ? {key,direction:'asc'} : null;
  }
  function updateChrome() {
    const active=activeSort(), shown=columns.filter(c=>state.visible[c.key]);
    for (const c of columns) {
      $('head-'+c.key).hidden=!state.visible[c.key];
      $('filtercell-'+c.key).hidden=!state.visible[c.key];
      const current=active?.key===c.key;
      $('head-'+c.key).setAttribute('aria-sort',current?(active.direction==='asc'?'ascending':'descending'):'none');
      $('sort-state-'+c.key).textContent=current?(active.direction==='asc'?'auf':'ab'):'';
      $('sort-'+c.key).setAttribute('aria-label',c.label+(current&&active.direction==='asc'?' absteigend':' aufsteigend')+' sortieren');
      $('show-'+c.key).checked=state.visible[c.key];
      $('show-'+c.key).disabled=shown.length===1&&state.visible[c.key];
    }
    $('results-table').style.minWidth=shown.reduce((sum,c)=>sum+c.width,0)+'px';
    const filtered=columns.filter(c=>state.filters[c.key].trim() ||
      (state.filters[c.key+'-status'] && state.filters[c.key+'-status']!=='all'));
    const hidden=columns.filter(c=>!state.visible[c.key]);
    $('column-status').textContent=[
      active?'Sortierung: '+columns.find(c=>c.key===active.key).label+', '+(active.direction==='asc'?'aufsteigend':'absteigend')+'.': 'Sortierung: grösster Unterschied zuerst.',
      filtered.length?'Spaltenfilter: '+filtered.map(c=>c.label+(!state.visible[c.key]?' (ausgeblendet)':'')).join(', ')+'.':'Keine Spaltenfilter.',
      hidden.length?'Ausgeblendet: '+hidden.map(c=>c.label).join(', ')+'.':''
    ].filter(Boolean).join(' ');
    $('column-menu-label').textContent='Spalten ('+shown.length+'/6)';
  }
  function changed() { state.preset=$('sort').value;persist();updateChrome();hooks.onChange(); }

  // A plain integer means exactly that value; ranges and comparison operators are supported.
  function numeric(query, number) {
    const q=query.trim().replace(/≤/g,'<=').replace(/≥/g,'>=').toLowerCase();
    let m=q.match(/^(-?\d+)\s*(?:–|-|\.\.|bis)\s*(-?\d+)$/);
    if (m) return number!==null && number>=Number(m[1]) && number<=Number(m[2]);
    m=q.match(/^(<=|>=|<|>|=)?\s*(-?\d+)$/);
    if (!m) return null;
    if (number===null) return false;
    const n=Number(m[2]);
    return m[1]==='<'?number<n:m[1]==='>'?number>n:m[1]==='<='?number<=n:m[1]==='>='?number>=n:number===n;
  }
  function matches(query, number, description) {
    if (!query.trim()) return true;
    const result=numeric(query,number);
    return result===null?text(description).includes(text(query)):result;
  }
  function filterRows(rows,data) {
    return rows.filter(r=>{
      const f=state.filters, rank=r.c.group_rank??r.c.rank, group=r.c.group==='CH'?'CH Schweiz':'DB DE Deutschland';
      const groupQuery=text(f.group);
      if (['ch','schweiz'].includes(groupQuery)) { if(r.c.group!=='CH')return false; }
      else if (['db','de','deutschland'].includes(groupQuery)) { if(r.c.group!=='DB')return false; }
      else if (!matches(f.group,rank,group+' '+rank)) return false;
      const station=[r.c.name,r.c.canton,r.c.sloid,r.c.place,r.c.importance_value,
        new Intl.NumberFormat('de-CH').format(r.c.importance_value),r.c.dtv_year,
        r.c.group==='CH'?'pro Tag':'Fahrplanfahrten-Gewichtung'].join(' ');
      if (f.name.trim() && !text(station).includes(text(f.name))) return false;
      for (const stage of ['d','t','i']) {
        const result=data.results[stage][r.i], status=f[stage+'-status'];
        if (status!=='all' && result.status!==status) return false;
        const description=hooks.grade(result)[0]+' '+(result.steps.at(-1)?.prefix||'');
        if (!matches(f[stage],result.status==='hit'?result.letters:null,description)) return false;
      }
      const comp=hooks.comparison(r.d,r.t), status=f['delta-status'];
      if (status!=='all' && comp.key!==status) return false;
      const delta=r.d.status==='hit'&&r.t.status==='hit'?Math.abs(r.d.letters-r.t.letters):null;
      return matches(f.delta,delta,comp.text);
    });
  }
  function sortRows(rows,data,preset) {
    if (preset!=='column') return false;
    const {key,direction}=state.sort, sign=direction==='asc'?1:-1;
    const number=r=>key==='group'?r.c.rank:key==='delta'?
      (r.d.status==='hit'&&r.t.status==='hit'?r.d.letters-r.t.letters:null):
      (data.results[key][r.i].status==='hit'?data.results[key][r.i].letters:null);
    rows.sort((a,b)=>{
      if (key==='name') return sign*a.c.name.localeCompare(b.c.name,'de')||a.c.rank-b.c.rank;
      const x=number(a),y=number(b);
      // Missing values stay at the bottom in either direction.
      if (x===null||y===null) return x===y?a.c.rank-b.c.rank:x===null?1:-1;
      return sign*(x-y)||a.c.rank-b.c.rank;
    });
    return true;
  }
  function setup(options) {
    hooks=options;restore();$('sort').value=state.preset;
    for (const key of fields) {
      const field=$('column-'+key);field.value=state.filters[key];
      field.addEventListener(key.endsWith('-status')?'change':'input',()=>{state.filters[key]=field.value;changed();});
    }
    for (const c of columns) {
      $('sort-'+c.key).addEventListener('click',()=>{
        const active=activeSort();
        state.sort={key:c.key,direction:active?.key===c.key&&active.direction==='asc'?'desc':'asc'};
        $('sort').value='column';changed();
      });
      $('show-'+c.key).addEventListener('change',()=>{
        state.visible[c.key]=$('show-'+c.key).checked;
        if (!columns.some(col=>state.visible[col.key])) state.visible[c.key]=true;
        changed();
      });
    }
    $('sort').addEventListener('change',changed);
    $('show-all-columns').addEventListener('click',()=>{for(const c of columns)state.visible[c.key]=true;changed();});
    $('reset-table-view').addEventListener('click',()=>{
      state=defaults();for(const key of fields)$('column-'+key).value=state.filters[key];
      $('search').value='';$('group').value='all';$('filter').value='all';$('sort').value='rank';changed();
    });
    updateChrome();
  }
  globalThis.rankingTableView={setup,filterRows,sortRows,
    cell:key=>'data-column="'+key+'"'+(state.visible[key]?'':' hidden'),
    getState:()=>JSON.parse(JSON.stringify(state))};
})();
