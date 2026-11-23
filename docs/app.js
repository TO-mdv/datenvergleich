'use strict';
/* Fahrplan-Datenvergleich ZVV – statische Auswertung (keine Abhängigkeiten). */

const STAGES = ['dino', 'nered', 'info'];
const CHAIN = [['dino', 'nered'], ['nered', 'info'], ['info', 'ref']];
const TRIP_CLASSES = [
  ['ok', 'identisch', '✓'], ['merged', 'gleicher Fahrplan, andere SJYID', '≡'], ['time', 'Zeiten > 1 Min', 'Zeit'], ['days', 'Verkehrstage', 'Tage'],
  ['stops', 'Halte', 'Halte'], ['missing', 'fehlt', 'fehlt'], ['extra', 'zusätzlich', 'neu']];
const DAY_CLASSES = [
  ['ok', 'identisch (±1 Min)'], ['merged', 'gleicher Fahrplan unter anderer SJYID'], ['time', 'Zeiten > 1 Min'], ['stops', 'Halte abweichend'],
  ['missing', 'fehlt'], ['extra', 'zusätzlich (nicht in Referenz)']];
const LABEL = Object.fromEntries(TRIP_CLASSES.map(c => [c[0], c[1]]));
LABEL.tol = 'Zeiten ±1 Min';
const SHORT = Object.fromEntries(TRIP_CLASSES.map(c => [c[0], c[2]]));
SHORT.tol = '±1';
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

let S = null;               // summary
const lineCache = new Map();
const state = { mode: 'ref', sort: { key: 'info', asc: true }, q: '', op: '', onlyDiff: true,
  calLine: '', calStage: 'info', fmLine: '', fmFilter: 'diff', fmTrip: null, fmDay: null };

const $ = (s, el = document) => el.querySelector(s);
const fmt = n => (n ?? 0).toLocaleString('de-CH');
const pct = (a, b) => b ? (100 * a / b) : null;
const pctTxt = (v, d = 1) => v == null ? '–' : (v >= 99.95 && v < 100 ? '>99.9' : v.toFixed(d)) + ' %';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stageMeta = id => S.stages.find(s => s.id === id);
const sname = id => stageMeta(id).label;
function dateOf(i) { const d = new Date(Date.UTC(2026, 11, 13 + i)); return d; }
function dateTxt(i, wd = true) {
  const d = dateOf(i);
  return (wd ? WD[(d.getUTCDay() + 6) % 7] + ' ' : '') + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
}
function hhmm(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  return String(h % 24).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (h >= 24 ? '⁺¹' : '');
}
function bits(hex) {
  const out = new Uint8Array(S.ndays);
  const n = hex.length;
  for (let j = 0; j < n; j++) {
    const v = parseInt(hex[n - 1 - j], 16);
    for (let b = 0; b < 4; b++) { const i = 4 * j + b; if (i < out.length && (v >> b) & 1) out[i] = 1; }
  }
  return out;
}

/* ---------- Tooltip */
const tip = $('#tip');
document.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.innerHTML = el.dataset.tip; tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 16 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});

/* ---------- Bausteine */
function dayCounts(d) {   // d = {ok,tol,time,stops,missing,extra}
  return { ok: (d.ok || 0) + (d.tol || 0), merged: d.merged || 0, time: d.time || 0, stops: d.stops || 0, missing: d.missing || 0, extra: d.extra || 0 };
}
function stackBar(parts, total, cls = '') {
  const segs = parts.filter(p => p[1] > 0).map(([k, v, lbl]) =>
    `<i class="c-${k}" style="flex:${v}" data-tip="<b>${esc(lbl || LABEL[k] || k)}</b><br>${fmt(v)} (${pctTxt(pct(v, total))})"></i>`).join('');
  return `<div class="sbar ${cls}">${segs || '<i class="c-none" style="flex:1"></i>'}</div>`;
}
function legend(classes) {
  return `<div class="legend">${classes.map(([k, l]) => `<span><i class="sw c-${k}"></i>${esc(l)}</span>`).join('')}</div>`;
}
function badge(k, txt) { return `<span class="badge"><i class="sw c-${k}"></i>${esc(txt ?? LABEL[k])}</span>`; }

/* ---------- Router */
const VIEWS = { uebersicht: viewOverview, linien: viewLines, kalender: viewCalendar, fahrten: viewTrips, methodik: viewMethod };
function route() {
  const [name, query] = (location.hash.slice(1) || 'uebersicht').split('?');
  const params = new URLSearchParams(query || '');
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === name));
  (VIEWS[name] || viewOverview)(params);
}
function go(view, params = {}) {
  const q = new URLSearchParams(params).toString();
  location.hash = view + (q ? '?' + q : '');
}
window.addEventListener('hashchange', route);

/* ================================================================ Übersicht */
function viewOverview() {
  const ref = S.ref;
  const cards = STAGES.map(k => {
    const m = stageMeta(k), d = dayCounts(S.days[k]), t = S.trips[k];
    const okp = pct(d.ok + d.merged, ref.days);
    const present = Object.entries(t).filter(([c]) => c !== 'missing' && c !== 'extra').reduce((a, [, v]) => a + v, 0);
    return `<div class="card kpi">
      <div class="stage"><b>${esc(m.label)}</b><span class="date">Stand ${esc(m.date)}</span></div>
      <div class="muted small">${esc(m.desc)}</div>
      <div class="hero" data-tip="Anteil der Referenz-Fahrtage, die in ${esc(m.label)} mit gleichen Halten und Zeiten (±1 Min) vorhanden sind – auch wenn unter anderer SJYID">${pctTxt(okp)} <small>der Fahrtage korrekt</small></div>
      <div class="small muted" style="margin-bottom:6px">davon ${pctTxt(pct(d.merged, ref.days))} nur unter anderer SJYID</div>
      ${stackBar([['ok', d.ok], ['merged', d.merged], ['time', d.time], ['stops', d.stops], ['missing', d.missing]], ref.days, 'big')}
      <div class="kv">
        <span>Referenzfahrten vorhanden</span><span>${fmt(present)} / ${fmt(ref.trips)}</span>
        <span>Fahrten fehlen ganz</span><span class="${t.missing ? 'neg' : ''}">${fmt(t.missing)}</span>
        <span>Fahrtage fehlen</span><span class="${d.missing ? 'neg' : ''}">${fmt(d.missing)}</span>
        <span>Fahrtage unter anderer SJYID</span><span>${fmt(d.merged)}</span>
        <span>Fahrtage mit anderen Halten</span><span>${fmt(d.stops)}</span>
        <span>Fahrtage mit anderen Zeiten</span><span>${fmt(d.time)}</span>
        <span>Fahrten zusätzlich (nicht in Ref.)</span><span>${fmt(t.extra)}</span>
      </div></div>`;
  }).join('');

  // Verarbeitungskette
  const node = k => {
    const m = stageMeta(k);
    const n = k === 'ref' ? S.ref.trips :
      Object.entries(S.trips[k]).filter(([c]) => c !== 'missing').reduce((a, [, v]) => a + v, 0);
    return `<div class="node ${k === 'ref' ? 'ref' : ''}"><b>${esc(m.label)}</b><span class="muted small">${esc(m.date)}</span>
      <div class="n">${fmt(n)}</div><span class="muted small">Fahrten (SJYID) im ZVV-Umfang</span></div>`;
  };
  const arrow = ([a, b]) => {
    const c = S.chain[a + '>' + b] || {};
    const changed = (c.days || 0) + (c.time || 0) + (c.stops || 0);
    // Für den letzten Schritt ist die Referenz der ältere Stand: Richtung umdrehen.
    const lost = b === 'ref' ? c.extra : c.missing, added = b === 'ref' ? c.missing : c.extra;
    const lostTxt = b === 'ref' ? 'nur in Referenz' : 'nicht übernommen';
    const addTxt = b === 'ref' ? 'nur in INFO+ ZVV' : 'neu';
    return `<div class="arrow">
      <div data-tip="${b === 'ref' ? 'Fahrten der Referenz, die in INFO+ ZVV fehlen' : 'Fahrten aus ' + esc(sname(a)) + ', die in ' + esc(sname(b)) + ' fehlen'}"><span class="neg">−${fmt(lost)}</span> ${lostTxt}</div>
      <div data-tip="${b === 'ref' ? 'Fahrten in INFO+ ZVV, die nicht in der Referenz sind' : 'Fahrten, die erst in ' + esc(sname(b)) + ' auftauchen'}"><span class="pos">+${fmt(added)}</span> ${addTxt}</div>
      <div data-tip="Fahrten in beiden Ständen, aber mit anderen Verkehrstagen, Halten oder Zeiten">~${fmt(changed)} verändert</div>
    </div>`;
  };
  const chain = `<div class="chain">${node('dino')}${arrow(CHAIN[0])}${node('nered')}${arrow(CHAIN[1])}${node('info')}${arrow(CHAIN[2])}${node('ref')}</div>`;

  // Top-Linien
  const worst = k => S.lines.filter(l => l.ref.days > 0).map(l => ({ l, miss: (l.st[k].days.missing || 0) + (l.st[k].days.stops || 0) + (l.st[k].days.time || 0) }))
    .filter(x => x.miss > 0).sort((a, b) => b.miss - a.miss).slice(0, 10);
  const topList = k => `<table class="t"><thead><tr><th>Linie</th><th class="num">Fahrtage abweichend</th><th class="num">korrekt</th></tr></thead><tbody>${
    worst(k).map(({ l, miss }) => `<tr class="row" data-line="${esc(l.id)}"><td>${esc(l.op)} <b>${esc(l.line)}</b></td><td class="num">${fmt(miss)}</td><td class="num">${pctTxt(pct(dayCounts(l.st[k].days).ok + dayCounts(l.st[k].days).merged, l.ref.days))}</td></tr>`).join('')
  }</tbody></table>`;

  const n = S.nosj;
  $('#main').innerHTML = `
    <p class="lead">Referenz ist der <b>Gesamtexport 2027</b> (${esc(stageMeta('ref').date)}), so wie die Daten bisher an die OJP-Auskunft gingen.
      Im ZVV-Umfang enthält er <b>${fmt(S.ref.trips)} Fahrten</b> mit <b>${fmt(S.ref.days)} Fahrtagen</b> (Fahrt × Verkehrstag).
      Für jeden Datenstand wird gezeigt, welcher Anteil dieser Fahrtage unverändert ankommt.</p>
    <div class="callout">Die Datenstände haben unterschiedliche Stichtage (Referenz ${esc(stageMeta('ref').date)}, DINO ${esc(stageMeta('dino').date)}, INFO+ ZVV ${esc(stageMeta('info').date)}).
      Ein Teil der Abweichungen sind deshalb echte Fahrplanänderungen und keine Verarbeitungsfehler.</div>
    <div class="grid3">${cards}</div>
    ${legend([['ok', 'identisch (±1 Min)'], ['merged', 'gleicher Fahrplan, andere SJYID'], ['time', 'Zeiten > 1 Min'], ['stops', 'Halte abweichend'], ['missing', 'fehlt']])}
    <div class="card"><h2>Verarbeitungskette</h2>
      <p class="muted small">Jeder Pfeil vergleicht einen Stand mit seinem Vorgänger (Fahrt-Ebene, über SJYID).</p>${chain}</div>
    <div class="grid3">${STAGES.map(k => `<div class="card"><h3>Grösste Abweichungen · ${esc(sname(k))}</h3>${topList(k)}</div>`).join('')}</div>
    <div class="card"><h3>Hinweise zur Datenqualität</h3><ul class="list">
      <li>INFO+ ZVV: <b>${fmt(n.info.outside || 0)}</b> Fahrten ohne SJYID ausserhalb des ZVV-Gebiets (PostAuto national) wurden ignoriert;
          ${fmt(n.info.matched || 0)} Fahrten ohne SJYID wurden über Laufweg und Zeiten zugeordnet, ${fmt(n.info.unmatched || 0)} nicht zuordenbar.</li>
      <li>NeRED V2: ${fmt((n.nered.matched || 0) + (n.nered.unmatched || 0))} Fahrten ohne SJYID (*I JY) – davon ${fmt(n.nered.matched || 0)} über Laufweg zugeordnet.</li>
      <li>DINO: ${fmt((n.dino.matched || 0) + (n.dino.unmatched || 0))} Fahrten ohne GLOBAL_ID.</li>
      <li><b>Neu vergebene SJYID</b>: Fahrten, die gegenüber der Referenz eine andere SJYID tragen, aber gleichen Laufweg und gleiche Zeiten haben, werden als dieselbe Fahrt gezählt
          (DINO ${fmt(S.remapped?.dino)}, NeRED ${fmt(S.remapped?.nered)}, INFO+ ${fmt(S.remapped?.info)}). In der Fahrtenmatrix sind sie mit ↻ markiert.</li>
      <li>Referenz-Umfang: ${fmt(S.scope.id)} Fahrten über SJYID, ${fmt(S.scope.area)} weitere Fahrten der ZVV-Betreiber im ZVV-Gebiet, die in keinem neuen Stand vorkommen.</li>
    </ul></div>`;
  document.querySelectorAll('tr[data-line]').forEach(tr => tr.onclick = () => go('fahrten', { linie: tr.dataset.line }));
}

/* ================================================================ Linien-Ampel */
function lineCell(l, k) {
  if (state.mode === 'ref') {
    const d = dayCounts(l.st[k].days), tot = l.ref.days;
    if (!tot) return { v: 101, html: `<span class="muted small">nicht in Referenz · ${fmt(l.st[k].trips.extra || 0)} Fahrten</span>` };
    const p = pct(d.ok + d.merged, tot);
    return { v: p, html: `<div class="cell"><span class="pct">${pctTxt(p, p >= 99.95 ? 1 : 0)}</span>${stackBar([['ok', d.ok], ['merged', d.merged], ['time', d.time], ['stops', d.stops], ['missing', d.missing]], tot, 'mini')}</div>` };
  }
  const key = k === 'nered' ? 'dino>nered' : k === 'info' ? 'nered>info' : 'info>ref';
  let c = { ...(l.chain[key] || {}) };
  if (k === 'ref') { const m = c.missing; c.missing = c.extra; c.extra = m; }   // Referenz als Basis
  const base = Object.entries(c).filter(([s]) => s !== 'extra').reduce((a, [, v]) => a + v, 0);
  const okv = (c.ok || 0) + (c.tol || 0);
  const chg = (c.days || 0) + (c.time || 0) + (c.stops || 0);
  if (!base) return { v: 101, html: `<span class="muted small">–${c.extra ? ' · +' + fmt(c.extra) + ' neu' : ''}</span>` };
  const p = pct(okv, base);
  return { v: p, html: `<div class="cell"><span class="pct">${pctTxt(p, p >= 99.95 ? 1 : 0)}</span>${stackBar([['ok', okv, 'unverändert'], ['days', chg, 'verändert'], ['missing', c.missing || 0, 'nicht übernommen'], ['extra', c.extra || 0, 'neu']], base + (c.extra || 0), 'mini')}</div>` };
}
function viewLines(params) {
  const ops = [...new Set(S.lines.map(l => l.op))].sort();
  const cols = state.mode === 'ref'
    ? STAGES.map(k => ({ k, title: sname(k) }))
    : [{ k: 'nered', title: 'DINO → NeRED' }, { k: 'info', title: 'NeRED → INFO+' }, { k: 'ref', title: 'INFO+ → Gesamt' }];
  $('#main').innerHTML = `
    <div class="card"><h2>Linien-Ampel</h2>
    <p class="muted small">${state.mode === 'ref'
      ? 'Je Linie und Datenstand: Anteil der Referenz-Fahrtage (Gesamt 2027), die mit gleichen Halten und Zeiten vorhanden sind. Sortiert nach dem schlechtesten Wert.'
      : 'Je Linie und Verarbeitungsschritt: Anteil der Fahrten, die unverändert vom Vorgänger übernommen wurden.'}
      Zeile anklicken für die Fahrtenmatrix.</p>
    <div class="toolbar">
      <span class="seg" id="mode"><button data-m="ref" class="${state.mode === 'ref' ? 'on' : ''}">Basis: Referenz Gesamt 2027</button><button data-m="chain" class="${state.mode === 'chain' ? 'on' : ''}">Basis: Vorstufe</button></span>
      <input type="search" id="q" placeholder="Linie oder Betreiber suchen" value="${esc(state.q)}">
      <label>Betreiber <select id="op"><option value="">alle</option>${ops.map(o => `<option ${o === state.op ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="only" ${state.onlyDiff ? 'checked' : ''}> nur Linien mit Abweichungen</label>
      <span class="muted small" id="cnt"></span>
    </div>
    ${state.mode === 'ref' ? legend([['ok', 'identisch (±1 Min)'], ['merged', 'andere SJYID'], ['time', 'Zeiten > 1 Min'], ['stops', 'Halte abweichend'], ['missing', 'fehlt']])
      : legend([['ok', 'unverändert'], ['days', 'verändert'], ['missing', 'nicht übernommen'], ['extra', 'neu']])}
    <div class="tablewrap"><table class="t" id="lt"><thead><tr>
      <th data-s="op">Betreiber</th><th data-s="line">Linie</th><th data-s="cat">Art</th>
      <th data-s="trips" class="num">Fahrten Ref.</th><th data-s="days" class="num">Fahrtage Ref.</th>
      ${cols.map(c => `<th data-s="${c.k}">${esc(c.title)}</th>`).join('')}
    </tr></thead><tbody></tbody></table></div></div>`;
  const draw = () => {
    const q = state.q.toLowerCase();
    let rows = S.lines.filter(l => (!state.op || l.op === state.op) && (!q || (l.op + ' ' + l.line).toLowerCase().includes(q)))
      .map(l => ({ l, c: Object.fromEntries(cols.map(c => [c.k, lineCell(l, c.k)])) }));
    if (state.onlyDiff) rows = rows.filter(r => cols.some(c => r.c[c.k].v < 99.95 || r.c[c.k].v === 101));
    const { key, asc } = state.sort;
    const val = r => key === 'op' ? r.l.op : key === 'line' ? r.l.line : key === 'cat' ? r.l.cat : key === 'trips' ? r.l.ref.trips : key === 'days' ? r.l.ref.days : (r.c[key] ? r.c[key].v : 0);
    rows.sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'de', { numeric: true }); return asc ? r : -r; });
    $('#cnt').textContent = fmt(rows.length) + ' Linien';
    $('#lt tbody').innerHTML = rows.map(({ l, c }) => `<tr class="row" data-line="${esc(l.id)}"><td>${esc(l.op)}</td><td><b>${esc(l.line)}</b></td><td>${esc(l.cat)}</td>
      <td class="num">${fmt(l.ref.trips)}</td><td class="num">${fmt(l.ref.days)}</td>${cols.map(k => `<td>${c[k.k].html}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="8" class="empty">Keine Linien.</td></tr>`;
    document.querySelectorAll('#lt th').forEach(th => { th.classList.toggle('sorted', th.dataset.s === key); th.classList.toggle('asc', asc); });
    document.querySelectorAll('#lt tr[data-line]').forEach(tr => tr.onclick = () => go('fahrten', { linie: tr.dataset.line }));
  };
  document.querySelectorAll('#mode button').forEach(b => b.onclick = () => {
    state.mode = b.dataset.m; state.sort = { key: state.mode === 'ref' ? 'info' : 'info', asc: true }; viewLines();
  });
  $('#q').oninput = e => { state.q = e.target.value; draw(); };
  $('#op').onchange = e => { state.op = e.target.value; draw(); };
  $('#only').onchange = e => { state.onlyDiff = e.target.checked; draw(); };
  document.querySelectorAll('#lt th').forEach(th => th.onclick = () => {
    const k = th.dataset.s; state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : true }; draw();
  });
  draw();
}

/* ================================================================ Linien-Daten */
async function loadLine(id) {
  if (lineCache.has(id)) return lineCache.get(id);
  const meta = S.lines.find(l => l.id === id);
  if (!meta) return null;
  const r = await fetch('data/lines/' + meta.f + '.json');
  const d = await r.json();
  d.meta = meta;
  d.maskBits = d.masks.map(() => null);
  d.bitsOf = i => d.maskBits[i] || (d.maskBits[i] = bits(d.masks[i]));
  lineCache.set(id, d);
  return d;
}
function variants(d, trip, k) {
  let v = trip.v[k];
  if (v === '=') v = trip.v.ref;
  if (!v) return [];
  return v.map(([p, t, m]) => ({ p: d.pats[p], t, m: d.bitsOf(m) }));
}
function classify(d, a, b) {
  if (a.p === b.p && a.t.every((x, i) => x === b.t[i])) return 0;
  if (a.p.length !== b.p.length) return 2;
  for (let i = 0; i < a.p.length; i++) {
    const x = d.stops[a.p[i]][0], y = d.stops[b.p[i]][0];
    if (x !== y && !x.startsWith('D') && !y.startsWith('D')) return 2;
  }
  let mx = 0;
  for (let i = 0; i < a.t.length; i++) if (a.t[i] != null && b.t[i] != null) mx = Math.max(mx, Math.abs(a.t[i] - b.t[i]));
  return mx <= 1 ? 0 : 1;
}
const DCLS = ['ok', 'time', 'stops'];
function dayClasses(d, trip, k) {
  const rv = variants(d, trip, 'ref'), sv = variants(d, trip, k);
  const out = new Array(S.ndays).fill(null);
  const mg = trip.st[k].m != null ? d.bitsOf(trip.st[k].m) : null, mx = trip.st[k].mx != null ? d.bitsOf(trip.st[k].mx) : null;
  for (let i = 0; i < S.ndays; i++) {
    const ra = rv.filter(v => v.m[i]), sa = sv.filter(v => v.m[i]);
    if (!ra.length && !sa.length) continue;
    if (!sa.length) { out[i] = mg && mg[i] ? 'merged' : 'missing'; continue; }
    if (!ra.length) { out[i] = mx && mx[i] ? 'merged' : 'extra'; continue; }
    let best = 9;
    for (const a of ra) for (const b of sa) best = Math.min(best, classify(d, a, b));
    out[i] = DCLS[best];
  }
  return out;
}

/* ================================================================ Kalender */
function lineOptions(sel, withAll) {
  const ls = [...S.lines].sort((a, b) => a.op.localeCompare(b.op) || a.line.localeCompare(b.line, 'de', { numeric: true }));
  return (withAll ? `<option value="">Alle Linien (ZVV-Umfang)</option>` : '') +
    ls.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.op)} · ${esc(l.line)}</option>`).join('');
}
const DIV = [['#d03b3b', '< 50 %'], ['#e98a8a', '50–90 %'], ['#f5c4c4', '90–99 %'], ['#e4e3de', '±1 %'], ['#b7d3f6', '101–110 %'], ['#6da7ec', '110–150 %'], ['#2a78d6', '> 150 %']];
function divColor(r, ref, st) {
  if (!ref && !st) return null;
  if (!ref) return DIV[6][0];
  if (r < 0.5) return DIV[0][0]; if (r < 0.9) return DIV[1][0]; if (r < 0.99) return DIV[2][0];
  if (r <= 1.01) return DIV[3][0]; if (r <= 1.1) return DIV[4][0]; if (r <= 1.5) return DIV[5][0]; return DIV[6][0];
}
const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#1c5cab'];
function heat(values, colorOf, tipOf) {
  const first = (dateOf(0).getUTCDay() + 6) % 7;   // Mo=0
  let html = '<div class="cal">', col = '<div class="wk">';
  for (let p = 0; p < first; p++) col += '<i class="d off"></i>';
  let filled = first;
  for (let i = 0; i < S.ndays; i++) {
    const c = colorOf(i);
    col += `<i class="d" style="${c ? 'background:' + c : ''}" data-tip="${esc(tipOf(i))}"></i>`;
    if (++filled % 7 === 0) { html += col + '</div>'; col = '<div class="wk">'; }
  }
  if (filled % 7) html += col + '</div>';
  return html + '</div>';
}
function monthHeader() {
  const first = (dateOf(0).getUTCDay() + 6) % 7;
  const weeks = Math.ceil((S.ndays + first) / 7);
  let out = '<div class="months">';
  let last = -1;
  for (let w = 0; w < weeks; w++) {
    const i = Math.max(0, w * 7 - first);
    const m = dateOf(i).getUTCMonth();
    out += `<span>${m !== last ? MONTHS[m] : ''}</span>`; last = m;
  }
  return out + '</div>';
}
async function viewCalendar(params) {
  if (params.get('linie') != null) state.calLine = params.get('linie');
  $('#main').innerHTML = `<div class="card"><h2>Kalender</h2>
    <p class="muted small">Jedes Kästchen ist ein Verkehrstag (Spalten = Wochen, Zeilen = Mo–So). Oben die Anzahl Fahrten der Referenz,
      darunter je Datenstand das Verhältnis zur Referenz. Grau = gleich viele Fahrten, rot = weniger, blau = mehr.
      So werden fehlende Feiertage, Ferienperioden oder abgeschnittene Zeiträume sofort sichtbar.</p>
    <div class="toolbar"><label>Linie <select id="cl">${lineOptions(state.calLine, true)}</select></label></div>
    <div id="calbody"><p class="loading">Lade …</p></div></div>
    <div class="card"><h3>Auffällige Tage</h3><div id="caltop"></div></div>`;
  $('#cl').onchange = e => go('kalender', { linie: e.target.value });
  let cal;
  if (!state.calLine) cal = S.calendar;
  else {
    const d = await loadLine(state.calLine);
    cal = { ref: new Array(S.ndays).fill(0) };
    STAGES.forEach(k => cal[k] = new Array(S.ndays).fill(0));
    for (const t of d.trips) {
      for (const k of ['ref', ...STAGES]) {
        const vs = variants(d, t, k);
        if (!vs.length) continue;
        for (let i = 0; i < S.ndays; i++) if (vs.some(v => v.m[i])) cal[k][i]++;
      }
    }
  }
  const max = Math.max(1, ...cal.ref);
  const refRow = heat(cal.ref, i => cal.ref[i] ? SEQ[Math.min(4, Math.floor(5 * cal.ref[i] / (max + 1)))] : null,
    i => `<b>${dateTxt(i)}</b><br>Referenz: ${fmt(cal.ref[i])} Fahrten`);
  const rows = STAGES.map(k => `<div class="calrow"><div class="lbl">${esc(sname(k))}</div>${heat(cal[k],
    i => divColor(cal.ref[i] ? cal[k][i] / cal.ref[i] : 0, cal.ref[i], cal[k][i]),
    i => `<b>${dateTxt(i)}</b><br>${esc(sname(k))}: ${fmt(cal[k][i])} Fahrten<br>Referenz: ${fmt(cal.ref[i])}<br>Differenz: ${cal[k][i] - cal.ref[i] > 0 ? '+' : ''}${fmt(cal[k][i] - cal.ref[i])}`)}</div>`).join('');
  $('#calbody').innerHTML = `${monthHeader()}<div class="calrow"><div class="lbl">Referenz</div>${refRow}</div>${rows}
    <div class="toolbar" style="margin-top:10px">
      <span class="ramp">Referenz: wenige ${SEQ.map(c => `<i style="background:${c}"></i>`).join('')} viele Fahrten</span>
      <span class="ramp">Verhältnis zur Referenz: ${DIV.map(([c, l]) => `<i style="background:${c}" data-tip="${esc(l)}"></i>`).join('')} <span class="small">(&lt;50 % … gleich … &gt;150 %)</span></span>
    </div>`;
  const days = [];
  for (let i = 0; i < S.ndays; i++) {
    const worst = Math.min(...STAGES.map(k => cal[k][i] - cal.ref[i]));
    const most = Math.max(...STAGES.map(k => Math.abs(cal[k][i] - cal.ref[i])));
    if (most) days.push({ i, worst, most });
  }
  days.sort((a, b) => b.most - a.most);
  $('#caltop').innerHTML = days.length ? `<table class="t"><thead><tr><th>Tag</th><th class="num">Referenz</th>${STAGES.map(k => `<th class="num">${esc(sname(k))}</th>`).join('')}</tr></thead><tbody>${
    days.slice(0, 20).map(({ i }) => `<tr><td>${dateTxt(i)}</td><td class="num">${fmt(cal.ref[i])}</td>${STAGES.map(k => {
      const dlt = cal[k][i] - cal.ref[i];
      return `<td class="num">${fmt(cal[k][i])} <span class="${dlt < 0 ? 'neg' : dlt > 0 ? 'pos' : 'muted'}">(${dlt > 0 ? '+' : ''}${fmt(dlt)})</span></td>`;
    }).join('')}</tr>`).join('')}</tbody></table><p class="muted small">Die 20 Tage mit der grössten Abweichung (Anzahl Fahrten) in einem der Datenstände.</p>`
    : '<p class="empty">Keine Abweichungen in der Anzahl Fahrten pro Tag.</p>';
}

/* ================================================================ Fahrtenmatrix */
function tripStatusList(t) { return STAGES.map(k => t.st[k].s); }
function isDiff(t) { return STAGES.some(k => !['ok', 'tol', 'merged'].includes(t.st[k].s)); }
async function viewTrips(params) {
  if (params.get('linie')) state.fmLine = params.get('linie');
  if (!state.fmLine) {
    const w = S.lines.filter(l => l.ref.days).map(l => ({ l, m: l.st.info.days.missing || 0 })).sort((a, b) => b.m - a.m)[0];
    state.fmLine = w ? w.l.id : S.lines[0].id;
  }
  const sj = params.get('fahrt');
  $('#main').innerHTML = `<div class="card"><h2>Fahrtenmatrix</h2>
    <p class="muted small">Jede Zeile ist eine Fahrt (SJYID) der gewählten Linie, sortiert nach Abfahrtszeit. Die Spalten zeigen den Zustand in jedem
      Datenstand gegenüber der Referenz. Fahrt anklicken: Verkehrstage und Fahrplan im Direktvergleich.</p>
    <div class="toolbar"><label>Linie <select id="fl">${lineOptions(state.fmLine, false)}</select></label>
      <span class="seg" id="ff"><button data-f="all">alle Fahrten</button><button data-f="diff">nur abweichende</button><button data-f="missing">nur fehlende</button></span>
      <input type="search" id="fq" placeholder="SJYID / Fahrtnummer / Halt">
      <span id="fcnt" class="muted small"></span></div>
    ${legend(TRIP_CLASSES.map(c => [c[0], c[2] + ' = ' + c[1]]))}
    <div id="fmsum"></div>
    <div class="fm"><div class="tablewrap mx" id="mx"><p class="loading">Lade …</p></div><div class="detail" id="det"><div class="card empty">Fahrt in der Liste auswählen.</div></div></div></div>`;
  document.querySelectorAll('#ff button').forEach(b => { b.classList.toggle('on', b.dataset.f === state.fmFilter); b.onclick = () => { state.fmFilter = b.dataset.f; document.querySelectorAll('#ff button').forEach(x => x.classList.toggle('on', x === b)); draw(); }; });
  $('#fl').onchange = e => { state.fmTrip = null; go('fahrten', { linie: e.target.value }); };
  const d = await loadLine(state.fmLine);
  const m = d.meta;
  $('#fmsum').innerHTML = `<div class="grid3" style="margin-bottom:12px">${STAGES.map(k => {
    const t = m.st[k].trips, tot = Object.values(t).reduce((a, b) => a + b, 0);
    return `<div><div class="small"><b>${esc(sname(k))}</b> · ${fmt(tot)} Fahrten</div>${stackBar(TRIP_CLASSES.map(c => [c[0], (t[c[0]] || 0) + (c[0] === 'ok' ? (t.tol || 0) : 0)]), tot)}</div>`;
  }).join('')}</div>`;
  const stopName = i => (d.stops[i] || ['', '?'])[1];
  let q = '';
  const draw = () => {
    let rows = d.trips;
    if (state.fmFilter === 'diff') rows = rows.filter(isDiff);
    if (state.fmFilter === 'missing') rows = rows.filter(t => STAGES.some(k => t.st[k].s === 'missing'));
    if (q) {
      const ql = q.toLowerCase();
      rows = rows.filter(t => t.sj.toLowerCase().includes(ql) || Object.values(t.nr || {}).flat().some(n => n.includes(q)) ||
        stopName(t.from).toLowerCase().includes(ql) || stopName(t.to).toLowerCase().includes(ql));
    }
    $('#fcnt').textContent = `${fmt(rows.length)} von ${fmt(d.trips.length)} Fahrten`;
    const shown = rows.slice(0, 2000);
    $('#mx').innerHTML = `<div class="h"><span>Ab</span><span>Von → Nach</span>${STAGES.map(k => `<span>${esc(stageMeta(k).short)}</span>`).join('')}</div>` +
      shown.map((t, i) => `<div class="r ${t.sj === state.fmTrip ? 'sel' : ''}" data-i="${d.trips.indexOf(t)}">
        <span class="t">${hhmm(t.dep)}</span><span class="w" title="${esc(stopName(t.from))} → ${esc(stopName(t.to))}">${esc(stopName(t.from))} → ${esc(stopName(t.to))}${t.r < 0 ? ' <span class="badge">nicht in Ref.</span>' : ''}</span>
        ${STAGES.map(k => { const s = t.st[k].s; const c = t.st[k].c || {};
          return `<span class="st c-${s}" data-tip="<b>${esc(sname(k))}: ${esc(LABEL[s])}</b>${Object.entries(c).map(([x, v]) => `<br>${esc(LABEL[x] || x)}: ${fmt(v)} Tage`).join('')}${t.st[k].nosj ? '<br>ohne SJYID zugeordnet' : ''}${t.st[k].sjold ? '<br>↻ andere SJYID: ' + esc(t.st[k].sjold) : ''}">${SHORT[s]}${t.st[k].sjold ? ' ↻' : ''}</span>`; }).join('')}
      </div>`).join('') + (rows.length > shown.length ? `<p class="muted small" style="padding:8px">… ${fmt(rows.length - shown.length)} weitere – Filter verwenden.</p>` : '') +
      (rows.length ? '' : '<p class="empty">Keine Fahrten für diesen Filter.</p>');
    document.querySelectorAll('#mx .r').forEach(r => r.onclick = () => {
      const t = d.trips[+r.dataset.i]; state.fmTrip = t.sj; state.fmDay = null;
      document.querySelectorAll('#mx .r').forEach(x => x.classList.toggle('sel', x === r));
      showTrip(d, t);
    });
  };
  $('#fq').oninput = e => { q = e.target.value.trim(); draw(); };
  draw();
  const pre = d.trips.find(t => t.sj === (sj || state.fmTrip));
  if (pre) showTrip(d, pre);
}

function showTrip(d, t) {
  const cls = Object.fromEntries(STAGES.map(k => [k, dayClasses(d, t, k)]));
  const refDays = variants(d, t, 'ref');
  const refAny = i => refDays.some(v => v.m[i]);
  // Tag mit Abweichung vorschlagen
  let day = state.fmDay;
  if (day == null) {
    for (let i = 0; i < S.ndays && day == null; i++) if (STAGES.some(k => cls[k][i] && cls[k][i] !== 'ok')) day = i;
    if (day == null) for (let i = 0; i < S.ndays && day == null; i++) if (refAny(i) || STAGES.some(k => cls[k][i])) day = i;
    if (day == null) day = 0;
  }
  const strip = (lbl, f) => `<div class="strip"><span class="small"><b>${esc(lbl)}</b></span><div class="bars">${
    Array.from({ length: S.ndays }, (_, i) => { const c = f(i); return `<i class="${c ? 'c-' + c : ''}" style="${c ? '' : 'background:var(--grid)'}${i === day ? ';outline:2px solid var(--ink);z-index:1' : ''}" data-tip="${esc(dateTxt(i))}${c ? ' · ' + esc(DAY_CLASSES.find(x => x[0] === c)?.[1] || c) : ' · kein Verkehr'}" data-day="${i}"></i>`; }).join('')}</div></div>`;
  const diffDays = [];
  for (let i = 0; i < S.ndays; i++) if (STAGES.some(k => cls[k][i] && cls[k][i] !== 'ok')) diffDays.push(i);

  // Fahrplantabelle für den Tag
  const active = k => variants(d, t, k).find(v => v.m[day]);
  const cols = ['ref', ...STAGES].map(k => ({ k, v: active(k) }));
  const base = cols.find(c => c.v)?.v;
  let rowsHtml = '<p class="empty">An diesem Tag verkehrt die Fahrt in keinem Datenstand.</p>';
  if (base) {
    // Haltereihenfolge: Referenz als Basis, weitere Halte einfügen
    const order = [];
    const add = (v) => {
      let pos = 0;
      v.p.forEach((si, j) => {
        const uic = d.stops[si][0];
        const found = order.findIndex((o, idx) => idx >= pos && o === uic);
        if (found >= 0) pos = found + 1; else { order.splice(pos, 0, uic); pos++; }
      });
    };
    cols.forEach(c => c.v && add(c.v));
    const name = Object.fromEntries(d.stops.map(s => [s[0], s[1]]));
    const timesOf = v => { const m = new Map(); if (!v) return m; v.p.forEach((si, j) => { const u = d.stops[si][0]; if (!m.has(u)) m.set(u, [v.t[2 * j], v.t[2 * j + 1]]); }); return m; };
    const tm = cols.map(c => timesOf(c.v));
    const refT = tm[0];
    rowsHtml = `<div class="tablewrap" style="max-height:52vh"><table class="tt"><thead><tr><th>Halt</th>${cols.map(c => `<th>${esc(stageMeta(c.k).short)}</th>`).join('')}</tr></thead><tbody>${
      order.map(u => `<tr><td class="stop">${esc(name[u] || u)} <span class="muted small">${esc(u)}</span></td>${cols.map((c, ci) => {
        if (!c.v) return '<td class="tm muted">–</td>';
        const x = tm[ci].get(u);
        if (!x) return `<td class="tm gone" data-tip="Halt fehlt in ${esc(sname(c.k))}">fehlt</td>`;
        const r = refT.get(u);
        const txt = x[0] != null && x[1] != null && x[0] !== x[1] ? hhmm(x[0]) + '–' + hhmm(x[1]) : hhmm(x[1] ?? x[0]);
        const dd = ci > 0 && cols[0].v ? (!r ? 99 : Math.max(Math.abs((r[0] ?? r[1]) - (x[0] ?? x[1])), Math.abs((r[1] ?? r[0]) - (x[1] ?? x[0])))) : 0;
        if (!r && ci > 0 && cols[0].v) return `<td class="tm new" data-tip="Halt nicht in der Referenz">${txt}</td>`;
        return `<td class="tm ${dd > 1 ? 'diff' : dd === 1 ? 'diff1' : ''}" ${dd ? `data-tip="Abweichung ${dd} Min gegenüber Referenz"` : ''}>${txt}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const nr = Object.entries(t.nr || {}).map(([k, v]) => `${esc(stageMeta(k).short)}: ${v.map(esc).join(', ')}`).join(' · ');
  $('#det').innerHTML = `<div class="card">
    <h3>${hhmm(t.dep)} ${esc((d.stops[t.from] || [])[1] || '')} → ${esc((d.stops[t.to] || [])[1] || '')}</h3>
    <div class="small muted" style="word-break:break-all">${esc(t.sj)}</div>
    ${STAGES.filter(k => t.st[k].sjold).map(k => `<div class="small">↻ ${esc(sname(k))} führt diese Fahrt unter anderer SJYID: <span class="muted" style="word-break:break-all">${esc(t.st[k].sjold)}</span></div>`).join('')}
    <div class="small muted">Fahrtnummern ${nr}${t.dir ? ' · Richtung ' + esc(t.dir) : ''}</div>
    <div style="margin:10px 0 4px">${STAGES.map(k => `<span style="margin-right:6px">${esc(stageMeta(k).short)} ${badge(t.st[k].s)}</span>`).join('')}</div>
    <h3 style="margin-top:14px">Verkehrstage (13.12.2026 – 11.12.2027)</h3>
    ${strip('Referenz', i => refAny(i) ? 'ok' : null).replace(/c-ok/g, 'c-ref')}
    ${STAGES.map(k => strip(stageMeta(k).short, i => cls[k][i])).join('')}
    ${legend(DAY_CLASSES)}
    <div class="daypick"><b class="small">Fahrplan am</b>
      <select id="dp">${(diffDays.length ? diffDays : []).slice(0, 400).map(i => `<option value="${i}" ${i === day ? 'selected' : ''}>${dateTxt(i)} (abweichend)</option>`).join('')}
        ${diffDays.includes(day) ? '' : `<option value="${day}" selected>${dateTxt(day)}</option>`}</select>
      <span class="muted small">oder Tag im Streifen anklicken</span></div>
    ${rowsHtml}
  </div>`;
  document.querySelectorAll('#det .bars i').forEach(el => el.onclick = () => { state.fmDay = +el.dataset.day; showTrip(d, t); });
  $('#dp').onchange = e => { state.fmDay = +e.target.value; showTrip(d, t); };
}

/* ================================================================ Methodik */
function viewMethod() {
  const st = S.stages;
  $('#main').innerHTML = `<div class="card method"><h2>Methodik</h2>
  <h3>Datenstände</h3>
  <table class="t" style="max-width:900px"><thead><tr><th>Stand</th><th>Beschreibung</th><th>Stichtag</th><th class="num">Datensätze</th></tr></thead><tbody>
    ${st.map(s => `<tr><td><b>${esc(s.label)}</b></td><td>${esc(s.desc)}</td><td>${esc(s.date)}</td><td class="num">${fmt(s.records)}</td></tr>`).join('')}
  </tbody></table>
  <h3 style="margin-top:16px">Abgleich</h3>
  <ul>
    <li><b>Schlüssel</b> ist die Swiss Journey ID (SJYID): DINO <code>trip.GLOBAL_ID</code>, HRDF <code>*I JY</code> → INFOTEXT. Mehrere Datensätze derselben SJYID
      (z. B. Kalendervarianten) werden zu einer Fahrt zusammengefasst.</li>
    <li>Fahrten ohne SJYID werden über ersten/letzten Halt und Zeiten einer Referenzfahrt zugeordnet, falls eindeutig. Ebenso Fahrten, deren SJYID gegenüber der Referenz neu vergeben wurde (↻).</li>
    <li>Fehlt ein Referenz-Fahrtag, gibt es aber am selben Tag auf derselben Linie eine überzählige Fahrt mit exakt gleichem Fahrplan, gilt der Tag als «gleicher Fahrplan, andere SJYID» (≡).</li>
    <li><b>Vergleichseinheit ist der Fahrtag</b> (Fahrt × Verkehrstag). Für jeden Tag der Referenz wird geprüft, ob die Fahrt im Datenstand verkehrt und ob
      Halte (DIDOK/UIC) und Zeiten übereinstimmen. Abweichungen ≤ 1 Minute gelten als identisch (DINO rechnet in Sekunden, HRDF in Minuten).</li>
    <li><b>ZVV-Umfang der Referenz</b>: alle Fahrten des Gesamtexports, deren SJYID in einem der neuen Stände vorkommt, plus Fahrten derselben Betreiber,
      die mehrheitlich an Haltestellen aus DINO halten.</li>
    <li>DINO-Halte werden über die SLOID auf die UIC-Nummer abgebildet (85 + SLOID). Halte ohne SLOID gelten beim Vergleich als Platzhalter.</li>
    <li>Verkehrstage: HRDF-Bitfelder (2 Füllbits, dann ab 13.12.2026), DINO über Tagesarten × Einschränkungen (RESTRICTION_DAYS je Monat 32 Bit).</li>
  </ul>
  <h3>Status einer Fahrt</h3>
  <ul>${TRIP_CLASSES.map(c => `<li>${badge(c[0], c[2])} ${esc(c[1])}: ${{
    ok: 'alle Fahrtage mit gleichen Halten und Zeiten (±1 Min) vorhanden',
    time: 'gleiche Halte, aber an mindestens einem Tag Zeiten mit mehr als 1 Min Abweichung',
    days: 'Fahrt vorhanden, aber an einzelnen Tagen fehlend oder zusätzlich',
    stops: 'an mindestens einem Tag andere Haltefolge (Halt fehlt, zusätzlich oder anderer Halt)',
    merged: 'Fahrt fehlt unter ihrer SJYID, aber am selben Tag gibt es auf der Linie eine Fahrt mit exakt gleichem Fahrplan unter anderer SJYID (z. B. von INFO+ zusammengelegt). Für die Fahrgastauskunft vollständig, für die Zuordnung von Echtzeitdaten über die SJYID aber relevant.',
    missing: 'Fahrt der Referenz fehlt im Datenstand vollständig',
    extra: 'Fahrt ist im Datenstand, aber nicht in der Referenz'}[c[0]]}</li>`).join('')}</ul>
  <h3>Was die Ansichten zeigen</h3>
  <ul>
    <li><b>Übersicht</b> – eine Kennzahl je Stand (Anteil korrekter Fahrtage) und die Verluste je Verarbeitungsschritt.</li>
    <li><b>Linien-Ampel</b> – wo liegen die Probleme? Sortierbare Tabelle je Linie, wahlweise gegen die Referenz oder gegen die Vorstufe.</li>
    <li><b>Kalender</b> – wann? Fahrten pro Tag im Verhältnis zur Referenz, macht fehlende Feiertage oder Perioden sichtbar.</li>
    <li><b>Fahrtenmatrix</b> – welche Fahrten genau? Jede Fahrt mit Status je Stand und Direktvergleich von Kalender und Fahrplan.</li>
  </ul>
  <p class="muted small">Nicht verglichen werden in dieser Ansicht Attribute, Infotexte, Richtungstexte und Durchbindungen – dafür steht die <a href="v1/">bisherige Detailansicht</a> weiter zur Verfügung.
  Aufbereitung: <code>python tools/build_compare.py --base &lt;Datenordner&gt; --out docs/data</code>.</p>
  </div>`;
}

/* ---------- Start */
(async function init() {
  try {
    const r = await fetch('data/summary.json');
    S = await r.json();
    $('#built').textContent = 'Aufbereitet ' + S.built;
    route();
  } catch (e) {
    $('#main').innerHTML = `<div class="card">Daten konnten nicht geladen werden: ${esc(e.message)}</div>`;
  }
})();
