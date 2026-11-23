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
const VIEWS = { uebersicht: viewOverview, linien: viewLines, kalender: viewCalendar, fahrten: viewTrips,
  zieltexte: viewZiel, angebote: viewAngebote, hinweise: viewHinweise, karte: viewMap, methodik: viewMethod };
function route() {
  const [name, query] = (location.hash.slice(1) || 'uebersicht').split('?');
  const params = new URLSearchParams(query || '');
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === name));
  document.body.classList.toggle('wide', name === 'karte');   // Karte über die ganze Bildschirmbreite
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
// Rot = weniger Fahrten als Referenz, Grün = gleich viele, Blau = mehr (Intensität = Grösse der Abweichung)
const DIV = [['#d03b3b', 'weniger: < 90 %'], ['#e98a8a', 'weniger: 90–99 %'], ['#f5c4c4', 'weniger: > 99 %'], ['#008300', 'gleich viele'],
  ['#b7d3f6', 'mehr: < 101 %'], ['#6da7ec', 'mehr: 101–110 %'], ['#2a78d6', 'mehr: > 110 %']];
function divColor(r, ref, st) {
  if (!ref && !st) return null;
  if (st === ref) return DIV[3][0];
  if (!ref) return DIV[6][0];
  if (st < ref) return r < 0.9 ? DIV[0][0] : r < 0.99 ? DIV[1][0] : DIV[2][0];
  return r <= 1.01 ? DIV[4][0] : r <= 1.1 ? DIV[5][0] : DIV[6][0];
}
const SEQ = ['#e4e3de', '#c9c8c2', '#a9a8a2', '#7a7974', '#52514e'];
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
      darunter je Datenstand der Vergleich zur Referenz: <b style="color:var(--ok)">grün</b> = gleich viele Fahrten,
      <b style="color:var(--missing)">rot</b> = weniger, <b style="color:var(--extra)">blau</b> = mehr (je kräftiger, desto grösser die Abweichung).
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
      <span class="ramp">Vergleich zur Referenz: <span class="small">weniger</span> ${DIV.map(([c, l]) => `<i style="background:${c}" data-tip="${esc(l)}"></i>`).join('')} <span class="small">mehr</span></span>
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
    <li><b>Zieltexte</b> – zeigt die Auskunft dieselbe Richtung an? DINO-Fahrtziel bzw. HRDF-Richtungstext, ersatzweise der Endhalt.</li>
    <li><b>Angebote</b> – bleiben HRDF-Attribute (Niederflur, Reservation, Gruppen …) an den Fahrten erhalten?</li>
    <li><b>Verkehrshinweise</b> – bleiben Infotexte bzw. DINO-Notizen an den Fahrten erhalten?</li>
    <li><b>Karte</b> – längster Fahrweg je Linie; jeder Abschnitt ist danach eingefärbt, in welchen Ständen er befahren wird (nur Referenz, auch in Zwischenschritten, überall).</li>
  </ul>
  <p class="muted small">Zieltexte, Angebote und Hinweise werden je Fahrt verglichen (vorhanden ja/nein), nicht je Verkehrstag oder Teilstrecke; gezählt werden nur Fahrten, die in Referenz und Datenstand vorkommen.
  Durchbindungen und Karte: <a href="v1/">bisherige Detailansicht</a>.
  Aufbereitung: <code>python tools/build_compare.py --base &lt;Datenordner&gt; --out docs/data</code>.</p>
  </div>`;
}

/* ================================================================ Zieltexte · Angebote · Verkehrshinweise */
let X = null;
async function loadExtras() {
  if (!X) {
    X = await (await fetch('data/extras.json')).json();
    X.lineById = Object.fromEntries(S.lines.map(l => [l.id, l]));
  }
  return X;
}
const lineLbl = id => { const l = X.lineById[id]; return l ? `${esc(l.op)} <b>${esc(l.line)}</b>` : esc(id); };
const lineTxt = id => { const l = X.lineById[id]; return l ? l.op + ' ' + l.line : id; };
const opOf = id => (X.lineById[id] || {}).op || '';
function opSelect(sel) {
  const ops = [...new Set(S.lines.map(l => l.op))].sort();
  return `<label>Betreiber <select id="xop"><option value="">alle</option>${ops.map(o => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
}
// c = [vorhanden, fehlt, zusätzlich, Referenzfahrten im Stand]
function keepCell(c) {
  if (!c) return { v: 101, html: '<span class="muted small">–</span>' };
  const [has, lost, add] = c;
  const base = has + lost;
  if (!base && !add) return { v: 101, html: '<span class="muted small">–</span>' };
  const p = base ? pct(has, base) : null;
  const tipx = `<br>vorhanden: ${fmt(has)}<br>fehlt: ${fmt(lost)}<br>zusätzlich: ${fmt(add)}`;
  return { v: p ?? 100, html: `<div class="cell" data-tip="${esc('Fahrten in Referenz und Datenstand' + tipx)}"><span class="pct">${base ? pctTxt(p, p >= 99.95 ? 1 : 0) : '<span class="pos">+' + fmt(add) + '</span>'}</span>${
    stackBar([['ok', has, 'vorhanden'], ['missing', lost, 'fehlt'], ['extra', add, 'zusätzlich']], has + lost + add, 'mini')}</div>` };
}
function sortRows(rows, val, sort) {
  const { key, asc } = sort;
  rows.sort((a, b) => { const x = val(a, key), y = val(b, key); const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'de', { numeric: true }); return asc ? r : -r; });
}
function bindSort(tableSel, sort, draw) {
  document.querySelectorAll(tableSel + ' th[data-s]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.s === sort.key); th.classList.toggle('asc', sort.asc);
    th.onclick = () => { const k = th.dataset.s; if (sort.key === k) sort.asc = !sort.asc; else { sort.key = k; sort.asc = !(k === 'n' || k === 'ref'); } draw(); };
  });
}
function kpiKeep(k, c, what) {
  const b = c[0] + c[1];
  return `<div class="card kpi"><div class="stage"><b>${esc(sname(k))}</b></div>
    <div class="hero">${pctTxt(pct(c[0], b))} <small>der ${what} erhalten</small></div>
    ${stackBar([['ok', c[0], 'vorhanden'], ['missing', c[1], 'fehlt'], ['extra', c[2], 'zusätzlich']], b + c[2], 'big')}
    <div class="kv"><span>vorhanden</span><span>${fmt(c[0])}</span><span>fehlt</span><span class="${c[1] ? 'neg' : ''}">${fmt(c[1])}</span><span>zusätzlich</span><span>${fmt(c[2])}</span></div></div>`;
}

/* ---------- Zieltexte */
const zstate = { q: '', op: '', stage: 'any', only: true, sort: { key: 'n', asc: false }, mode: 'diff' };
async function viewZiel() {
  $('#main').innerHTML = '<p class="loading">Lade …</p>';
  await loadExtras();
  const tot = Object.fromEntries(STAGES.map(k => [k, { same: 0, diff: 0 }]));
  for (const v of Object.values(X.ztLines)) for (const k of STAGES) { tot[k].same += v[k]?.same || 0; tot[k].diff += v[k]?.diff || 0; }
  const expl = Object.fromEntries(['ref', ...STAGES].map(k => [k, 0]));
  const all = Object.fromEntries(['ref', ...STAGES].map(k => [k, 0]));
  for (const r of X.zt) {
    all.ref += r.n; if (r.ref[1] === 'R') expl.ref += r.n;
    for (const k of STAGES) if (r.st[k]) { all[k] += r.n; if (r.st[k][1] === 'R') expl[k] += r.n; }
  }
  const cards = STAGES.map(k => {
    const t = tot[k], n = t.same + t.diff;
    return `<div class="card kpi"><div class="stage"><b>${esc(sname(k))}</b></div>
      <div class="hero">${pctTxt(pct(t.same, n))} <small>gleicher Zieltext</small></div>
      ${stackBar([['ok', t.same, 'gleicher Zieltext'], ['time', t.diff, 'anderer Zieltext']], n, 'big')}
      <div class="kv"><span>Fahrten verglichen</span><span>${fmt(n)}</span><span>anderer Zieltext</span><span class="${t.diff ? 'neg' : ''}">${fmt(t.diff)}</span>
      <span>mit eigenem Zieltext</span><span>${pctTxt(pct(expl[k], all[k]))}</span></div></div>`;
  }).join('');
  $('#main').innerHTML = `
    <p class="lead">Der Zieltext ist die «Richtung», die die Auskunft zu einer Fahrt anzeigt. Für jede Referenzfahrt wird verglichen, welcher Zieltext in jedem Datenstand ankommt.
      Quelle: DINO <code>vehicle_destination_text</code> (über <code>trip_vdt</code>, am ersten Halt), HRDF <code>*R</code> → RICHTUNG.
      Hat eine Fahrt keinen eigenen Zieltext, gilt – wie in der Auskunft – der Endhalt <span class="tag">Endhalt</span>.</p>
    <div class="callout info">Eigener Zieltext vorhanden bei: Referenz ${pctTxt(pct(expl.ref, all.ref))} · DINO ${pctTxt(pct(expl.dino, all.dino))} · NeRED ${pctTxt(pct(expl.nered, all.nered))} · INFO+ ${pctTxt(pct(expl.info, all.info))} der Fahrten.</div>
    <div class="grid3">${cards}</div>
    ${legend([['ok', 'gleicher Zieltext wie Referenz'], ['time', 'anderer Zieltext']])}
    <div class="card"><h2>${zstate.mode === 'diff' ? 'Zieltexte je Linie' : 'Übereinstimmung je Linie'}</h2>
      <p class="muted small">${zstate.mode === 'diff' ? 'Fahrten einer Linie mit derselben Kombination von Zieltexten sind zu einer Zeile zusammengefasst. Gelb = weicht von der Referenz ab, – = Fahrt fehlt im Datenstand. Zeile anklicken öffnet eine Beispielfahrt in der Fahrtenmatrix.' : 'Anteil der Fahrten je Linie mit gleichem Zieltext wie in der Referenz.'}</p>
      <div class="toolbar">
        <span class="seg" id="zm"><button data-m="diff" class="${zstate.mode === 'diff' ? 'on' : ''}">Zieltexte</button><button data-m="line" class="${zstate.mode === 'line' ? 'on' : ''}">je Linie</button></span>
        <input type="search" id="zq" placeholder="Linie oder Text suchen" value="${esc(zstate.q)}">${opSelect(zstate.op)}
        <label>Abweichung in <select id="zs"><option value="any">irgendeinem Stand</option>${STAGES.map(k => `<option value="${k}" ${zstate.stage === k ? 'selected' : ''}>${esc(sname(k))}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="zo" ${zstate.only ? 'checked' : ''}> nur Abweichungen</label><span class="muted small" id="zc"></span></div>
      <div class="tablewrap"><table class="t" id="zt"></table></div></div>`;
  const zdiff = (r, k) => r.st[k] && r.st[k][0].toLowerCase() !== r.ref[0].toLowerCase();
  const ztxt = z => z ? `${esc(z[0])}${z[1] === 'E' ? ' <span class="tag">Endhalt</span>' : ''}` : '<span class="muted">–</span>';
  const draw = () => {
    const q = zstate.q.toLowerCase();
    const stg = zstate.stage === 'any' ? STAGES : [zstate.stage];
    if (zstate.mode === 'diff') {
      let rows = X.zt.filter(r => (!zstate.op || opOf(r.l) === zstate.op) &&
        (!q || (lineTxt(r.l) + ' ' + r.ref[0] + ' ' + STAGES.map(k => r.st[k]?.[0] || '').join(' ')).toLowerCase().includes(q)));
      if (zstate.only) rows = rows.filter(r => stg.some(k => zdiff(r, k)));
      sortRows(rows, (r, k) => k === 'n' ? r.n : k === 'l' ? lineTxt(r.l) : k === 'ref' ? r.ref[0] : (r.st[k]?.[0] || ''), zstate.sort);
      $('#zc').textContent = `${fmt(rows.length)} Zeilen · ${fmt(rows.reduce((a, r) => a + r.n, 0))} Fahrten`;
      $('#zt').innerHTML = `<thead><tr><th data-s="l">Linie</th><th data-s="ref">Referenz</th>${STAGES.map(k => `<th data-s="${k}">${esc(sname(k))}</th>`).join('')}<th data-s="n" class="num">Fahrten</th></tr></thead><tbody>${
        rows.slice(0, 1500).map(r => `<tr class="row" data-l="${esc(r.l)}" data-sj="${esc(r.sj)}"><td>${lineLbl(r.l)}</td><td class="txt">${ztxt(r.ref)}</td>${
          STAGES.map(k => `<td class="txt ${zdiff(r, k) ? 'zdiff' : ''}">${ztxt(r.st[k])}</td>`).join('')}<td class="num">${fmt(r.n)}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="empty">Keine Zeilen.</td></tr>'}</tbody>`;
    } else {
      let rows = Object.entries(X.ztLines).filter(([l]) => (!zstate.op || opOf(l) === zstate.op) && (!q || lineTxt(l).toLowerCase().includes(q)))
        .map(([l, v]) => ({ l, v, p: Object.fromEntries(STAGES.map(k => { const s = v[k] || {}; const n = (s.same || 0) + (s.diff || 0); return [k, n ? pct(s.same || 0, n) : 101]; })) }));
      if (zstate.only) rows = rows.filter(r => stg.some(k => r.p[k] < 100));
      const srt = STAGES.includes(zstate.sort.key) || zstate.sort.key === 'l' ? zstate.sort : { key: 'info', asc: true };
      sortRows(rows, (r, k) => k === 'l' ? lineTxt(r.l) : r.p[k], srt);
      $('#zc').textContent = `${fmt(rows.length)} Linien`;
      $('#zt').innerHTML = `<thead><tr><th data-s="l">Linie</th>${STAGES.map(k => `<th data-s="${k}">${esc(sname(k))}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr class="row" data-l="${esc(r.l)}"><td>${lineLbl(r.l)}</td>${STAGES.map(k => {
          const s = r.v[k] || {}, n = (s.same || 0) + (s.diff || 0);
          return `<td>${n ? `<div class="cell"><span class="pct">${pctTxt(r.p[k], r.p[k] >= 99.95 ? 1 : 0)}</span>${stackBar([['ok', s.same || 0, 'gleicher Zieltext'], ['time', s.diff || 0, 'anderer Zieltext']], n, 'mini')}</div>` : '<span class="muted small">–</span>'}</td>`;
        }).join('')}</tr>`).join('') || '<tr><td colspan="4" class="empty">Keine Linien.</td></tr>'}</tbody>`;
    }
    bindSort('#zt', zstate.sort, draw);
    document.querySelectorAll('#zt tr[data-l]').forEach(tr => tr.onclick = () => go('fahrten', tr.dataset.sj ? { linie: tr.dataset.l, fahrt: tr.dataset.sj } : { linie: tr.dataset.l }));
  };
  document.querySelectorAll('#zm button').forEach(b => b.onclick = () => { zstate.mode = b.dataset.m; viewZiel(); });
  $('#zq').oninput = e => { zstate.q = e.target.value; draw(); };
  $('#xop').onchange = e => { zstate.op = e.target.value; draw(); };
  $('#zs').onchange = e => { zstate.stage = e.target.value; draw(); };
  $('#zo').onchange = e => { zstate.only = e.target.checked; draw(); };
  draw();
}

/* ---------- Angebote (HRDF-Attribute) */
const astate = { code: '', q: '', op: '', sort: { key: 'ref', asc: false }, lsort: { key: 'info', asc: true } };
const ASTAGES = ['nered', 'info'];
async function viewAngebote(params) {
  $('#main').innerHTML = '<p class="loading">Lade …</p>';
  await loadExtras();
  if (params && params.get('code') != null) astate.code = params.get('code');
  const sum = rows => {
    const o = { ref: 0 }; ASTAGES.forEach(k => o[k] = [0, 0, 0, 0]);
    for (const r of rows) { o.ref += r.ref; ASTAGES.forEach(k => { if (r[k]) for (let i = 0; i < 4; i++) o[k][i] += r[k][i]; }); }
    return o;
  };
  const byCode = {};
  for (const r of X.att) (byCode[r.a] = byCode[r.a] || []).push(r);
  const codes = Object.entries(byCode).map(([a, rows]) => ({ a, name: X.attrNames[a] || '', lines: rows.length, ...sum(rows) }));
  const totals = sum(X.att);
  $('#main').innerHTML = `
    <p class="lead">Angebote sind die HRDF-Attribute einer Fahrt (<code>*A</code>, z. B. Niederflur, Reservation, Gruppen, Velo).
      Für jede Referenzfahrt wird geprüft, ob ihre Attribute im neuen Datenstand erhalten bleiben. Gezählt werden nur Fahrten, die es in Referenz und Datenstand gibt.</p>
    <div class="callout">DINO kennt diese Angebote nicht als Fahrtattribute (Bemerkungen wie Rufbus-Reservationen stehen dort als Notiz – siehe <a href="#hinweise">Verkehrshinweise</a>).
      Verglichen werden deshalb NeRED und INFO+ ZVV mit der Referenz.</div>
    <div class="grid2">${ASTAGES.map(k => kpiKeep(k, totals[k], 'Attribut-Zuweisungen')).join('')}</div>
    ${legend([['ok', 'Attribut vorhanden'], ['missing', 'Attribut fehlt'], ['extra', 'Attribut zusätzlich (nicht in Referenz)']])}
    <div class="card"><h2>Angebote</h2><p class="muted small">Zeile anklicken zeigt die Linien mit diesem Angebot.</p>
      <div class="tablewrap" style="max-height:50vh"><table class="t" id="at"></table></div></div>
    <div class="card" id="acard"></div>`;
  const drawCodes = () => {
    const rows = [...codes];
    sortRows(rows, (r, k) => k === 'a' ? r.a : k === 'name' ? r.name : k === 'ref' ? r.ref : k === 'lines' ? r.lines : keepCell(r[k]).v, astate.sort);
    $('#at').innerHTML = `<thead><tr><th data-s="a">Code</th><th data-s="name">Bezeichnung</th><th data-s="lines" class="num">Linien</th><th data-s="ref" class="num">Fahrten Ref.</th>${ASTAGES.map(k => `<th data-s="${k}">${esc(sname(k))}</th>`).join('')}</tr></thead><tbody>${
      rows.map(r => `<tr class="row ${r.a === astate.code ? 'selrow' : ''}" data-a="${esc(r.a)}"><td><b>${esc(r.a)}</b></td><td>${esc(r.name) || '<span class="muted">?</span>'}</td><td class="num">${fmt(r.lines)}</td><td class="num">${fmt(r.ref)}</td>${ASTAGES.map(k => `<td>${keepCell(r[k]).html}</td>`).join('')}</tr>`).join('')}</tbody>`;
    bindSort('#at', astate.sort, drawCodes);
    document.querySelectorAll('#at tr[data-a]').forEach(tr => tr.onclick = () => { astate.code = tr.dataset.a; drawCodes(); drawLines(); $('#acard').scrollIntoView({ behavior: 'smooth' }); });
  };
  const drawLines = () => {
    if (!astate.code) { $('#acard').innerHTML = '<p class="empty">Angebot in der Tabelle oben auswählen.</p>'; return; }
    $('#acard').innerHTML = `<h2>${esc(astate.code)} · ${esc(X.attrNames[astate.code] || '')} – je Linie</h2>
      <div class="toolbar"><input type="search" id="aq" placeholder="Linie suchen" value="${esc(astate.q)}">${opSelect(astate.op)}<span class="muted small" id="acnt"></span></div>
      <div class="tablewrap"><table class="t" id="al"></table></div>`;
    const body = () => {
      const q = astate.q.toLowerCase();
      const rows = (byCode[astate.code] || []).filter(r => (!astate.op || opOf(r.l) === astate.op) && (!q || lineTxt(r.l).toLowerCase().includes(q)));
      sortRows(rows, (r, k) => k === 'l' ? lineTxt(r.l) : k === 'ref' ? r.ref : keepCell(r[k]).v, astate.lsort);
      $('#acnt').textContent = fmt(rows.length) + ' Linien';
      $('#al').innerHTML = `<thead><tr><th data-s="l">Linie</th><th data-s="ref" class="num">Fahrten Ref.</th>${ASTAGES.map(k => `<th data-s="${k}">${esc(sname(k))}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr class="row" data-l="${esc(r.l)}"><td>${lineLbl(r.l)}</td><td class="num">${fmt(r.ref)}</td>${ASTAGES.map(k => `<td>${keepCell(r[k]).html}</td>`).join('')}</tr>`).join('')}</tbody>`;
      bindSort('#al', astate.lsort, body);
      document.querySelectorAll('#al tr[data-l]').forEach(tr => tr.onclick = () => go('fahrten', { linie: tr.dataset.l }));
    };
    $('#aq').oninput = e => { astate.q = e.target.value; body(); };
    $('#xop').onchange = e => { astate.op = e.target.value; body(); };
    body();
  };
  drawCodes(); drawLines();
}

/* ---------- Verkehrshinweise (Infotexte / DINO-Notizen) */
const hstate = { mode: 'text', q: '', op: '', only: true, sort: { key: 'ref', asc: false } };
async function viewHinweise() {
  $('#main').innerHTML = '<p class="loading">Lade …</p>';
  await loadExtras();
  const blank = () => ({ ref: 0, ...Object.fromEntries(STAGES.map(k => [k, [0, 0, 0, 0]])) });
  const add = (o, r) => { o.ref += r.ref; for (const k of STAGES) for (let i = 0; i < 4; i++) o[k][i] += r[k][i]; };
  const totals = blank(); X.hint.forEach(r => add(totals, r));
  const byText = {};
  for (const r of X.hint) { const o = byText[r.t] || (byText[r.t] = { t: r.t, code: r.code, lines: new Set(), ...blank() }); o.lines.add(r.l); o.code = o.code || r.code; add(o, r); }
  const codeLbl = c => X.noteCodes[c] ? `${esc(X.noteCodes[c])} <span class="muted">(${esc(c)})</span>` : esc(c || '–');
  $('#main').innerHTML = `
    <p class="lead">Verkehrshinweise sind die Infotexte einer Fahrt (HRDF <code>*I</code>, ohne SJYID und Fahrtnummer) bzw. in DINO die Notizen der Fahrt (<code>trip.NOTICE</code> → <code>notice.din</code>).
      Für jede Referenzfahrt wird geprüft, ob derselbe Text (ohne Formatierungscodes wie <code>{RR}</code>) im Datenstand an der Fahrt hängt.</p>
    <div class="grid3">${STAGES.map(k => kpiKeep(k, totals[k], 'Hinweise')).join('')}</div>
    ${legend([['ok', 'Hinweis vorhanden'], ['missing', 'Hinweis fehlt'], ['extra', 'Hinweis zusätzlich (nicht in Referenz)']])}
    <div class="card"><h2>Hinweistexte</h2>
      <p class="muted small">Werte = Anzahl Fahrten mit dem Hinweis. Prozent = Anteil der Referenzfahrten mit diesem Hinweis, bei denen er im Datenstand erhalten ist.
        ${hstate.mode === 'text' ? 'Zeile anklicken zeigt den Text je Linie.' : 'Zeile anklicken öffnet die Linie in der Fahrtenmatrix.'}</p>
      <div class="toolbar"><span class="seg" id="hm"><button data-m="text" class="${hstate.mode === 'text' ? 'on' : ''}">je Text</button><button data-m="line" class="${hstate.mode === 'line' ? 'on' : ''}">je Linie und Text</button></span>
        <input type="search" id="hq" placeholder="Text oder Linie suchen" value="${esc(hstate.q)}">${opSelect(hstate.op)}
        <label><input type="checkbox" id="ho" ${hstate.only ? 'checked' : ''}> nur Abweichungen</label><span class="muted small" id="hc"></span></div>
      <div class="tablewrap"><table class="t" id="ht"></table></div></div>`;
  const draw = () => {
    const q = hstate.q.toLowerCase();
    let rows = hstate.mode === 'text' ? Object.values(byText) : X.hint;
    rows = rows.filter(r => {
      const ls = hstate.mode === 'text' ? [...r.lines] : [r.l];
      return (!hstate.op || ls.some(l => opOf(l) === hstate.op)) && (!q || (r.t + ' ' + ls.map(lineTxt).join(' ')).toLowerCase().includes(q));
    });
    if (hstate.only) rows = rows.filter(r => STAGES.some(k => r[k][1] || r[k][2]));
    sortRows(rows, (r, k) => k === 't' ? r.t : k === 'code' ? r.code : k === 'ref' ? r.ref : k === 'l' ? (hstate.mode === 'text' ? r.lines.size : lineTxt(r.l)) : keepCell(r[k]).v, hstate.sort);
    $('#hc').textContent = `${fmt(rows.length)} Zeilen`;
    $('#ht').innerHTML = `<thead><tr><th data-s="t">Text</th><th data-s="code">Art</th><th data-s="l" class="${hstate.mode === 'text' ? 'num' : ''}">${hstate.mode === 'text' ? 'Linien' : 'Linie'}</th><th data-s="ref" class="num">Fahrten Ref.</th>${STAGES.map(k => `<th data-s="${k}">${esc(sname(k))}</th>`).join('')}</tr></thead><tbody>${
      rows.slice(0, 1500).map(r => `<tr class="row" data-l="${esc(hstate.mode === 'line' ? r.l : '')}" data-t="${esc(r.t)}"><td class="txt hint">${esc(r.t)}</td><td class="small">${codeLbl(r.code)}</td>
        <td class="${hstate.mode === 'text' ? 'num' : ''}">${hstate.mode === 'text' ? `<span data-tip="${esc([...r.lines].slice(0, 30).map(lineTxt).map(esc).join('<br>') + (r.lines.size > 30 ? '<br>…' : ''))}">${fmt(r.lines.size)}</span>` : lineLbl(r.l)}</td>
        <td class="num">${fmt(r.ref)}</td>${STAGES.map(k => `<td>${keepCell(r[k]).html}</td>`).join('')}</tr>`).join('') ||
      '<tr><td colspan="7" class="empty">Keine Zeilen.</td></tr>'}</tbody>`;
    bindSort('#ht', hstate.sort, draw);
    document.querySelectorAll('#ht tr[data-t]').forEach(tr => tr.onclick = () => {
      if (tr.dataset.l) go('fahrten', { linie: tr.dataset.l });
      else { hstate.mode = 'line'; hstate.q = tr.dataset.t.slice(0, 60); viewHinweise(); }
    });
  };
  document.querySelectorAll('#hm button').forEach(b => b.onclick = () => { hstate.mode = b.dataset.m; viewHinweise(); });
  $('#hq').oninput = e => { hstate.q = e.target.value; draw(); };
  $('#xop').onchange = e => { hstate.op = e.target.value; draw(); };
  $('#ho').onchange = e => { hstate.only = e.target.checked; draw(); };
  draw();
}

/* ================================================================ Karte */
// Abschnittsklassen nach Bitmaske (ref=1, dino=2, nered=4, info=8)
const MAP_CLASSES = [
  ['ok', 'in allen Ständen', m => m === 15],
  ['time', 'in Referenz und INFO+, fehlt in DINO oder NeRED', m => (m & 1) && (m & 8) && m !== 15],
  ['days', 'in Referenz, fehlt in INFO+ (aber in DINO/NeRED)', m => (m & 1) && !(m & 8) && m !== 1],
  ['missing', 'nur in Referenz', m => m === 1],
  ['extra', 'nicht in Referenz (nur neue Stände)', m => !(m & 1) && m > 0]];
const MAP_COLORS = { ok: '#008300', time: '#eda100', days: '#e87ba4', missing: '#d03b3b', extra: '#2a78d6' };
const mstate = { show: { ok: true, time: true, days: true, missing: true, extra: true }, op: '', q: '', fitted: false, mot: {} };
let M = null, lmap = null, mlayer = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function ensureLeaflet() {
  if (window.L) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'v1/vendor/leaflet.css'; document.head.appendChild(l);
  await loadScript('v1/vendor/leaflet.js');
}
// Verkehrsmittel-Symbol je Linie: [Symbol, Bezeichnung, Nachtlinie]
// Piktogramme aus der SBB-Icon-Bibliothek (https://digital.sbb.ch/de/foundation/assets/icons/), 24x24
const SBB_ICONS = {
"boat-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M8 5h1V4H2v1h1v2H2v1h11v1H2v1h1v2H2v1h17.428l-3.722 4.43-.573.195a2 2 0 0 1-1.11.045l-.156-.045-1.42-.47a3 3 0 0 0-1.662-.066l-.232.066-1.42.47a2 2 0 0 1-1.11.045l-.156-.045-1.42-.47a3 3 0 0 0-1.894 0l-.013.005-.014.005-2.21.87.368.93 2.198-.865c.407-.132.845-.13 1.25.005l1.42.47.233.067a3 3 0 0 0 1.662-.068l1.42-.47.155-.044a2 2 0 0 1 1.11.045l1.42.47.233.067a3 3 0 0 0 1.662-.068h.003l.71-.24.133-.045.09-.107 4.5-5.36.69-.822H12v-2h2V7H8zm3 5H8v2h3zm5.383 8.182L16 17.86h-.001zM7 10v2H4v-2zM4 7V5h3v2zm12.785 12.088a3 3 0 0 1 1.662.068l.013.004.014.005 2.21.87-.368.93-2.19-.862a2 2 0 0 0-1.104-.043l-.155.045-1.42.47a3 3 0 0 1-1.662.066l-.232-.066-1.42-.47a2 2 0 0 0-1.11-.045l-.156.045-1.42.47a3 3 0 0 1-1.662.066l-.232-.066-1.42-.47a2 2 0 0 0-1.26-.002l-2.19.862-.367-.93 2.21-.87.014-.005.013-.004a3 3 0 0 1 1.894 0l1.42.47.155.044c.366.09.751.075 1.11-.045l1.42-.47.233-.067a3 3 0 0 1 1.662.068l1.42.47.155.044c.366.09.751.075 1.11-.045l1.42-.47z\" clip-rule=\"evenodd\"/>",
"bus-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M20 11.972V16.5a.5.5 0 0 1-.5.5H11a3 3 0 1 0-6 0H2v1h3.17a3.001 3.001 0 0 0 5.66 0h8.67a1.5 1.5 0 0 0 1.5-1.5v-4.528a2.5 2.5 0 0 0-.264-1.117l-2.46-4.92A3.5 3.5 0 0 0 15.146 4H2v1h13.146a2.5 2.5 0 0 1 2.236 1.382l2.46 4.92a1.5 1.5 0 0 1 .158.67M6 12V6H2v1h3v4H2v1zm7-6v6H7V6zm-5 5h4V7H8zm0 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4m7.809-9 .138.276L19 12.382V14h-5V6zM15 13h3v-.382L15.191 7H15z\" clip-rule=\"evenodd\"/>",
"cable-car-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M22.241 2.976 22 2.006l-20 5 .242.97L9.14 6.25l-2.837 5.24H3.62a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h17a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2.681l-3.11-6.662zm-8.4 2.1-3.386.846L7.44 11.49h9.396zm7.279 7.914a.5.5 0 0 0-.5-.5h-17a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h17a.5.5 0 0 0 .5-.5zm-13 .5v5h-4v-5zm-3 4h2v-3h-2zm9 1v-5h-4v5zm-1-1h-2v-3h2zm7-4v5h-4v-5zm-3 4h2v-3h-2z\" clip-rule=\"evenodd\"/>",
"funicular-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M18.997 3.01a1.5 1.5 0 0 0-.652-.033l-.002.001-16.33 2.88.174.984 16.33-2.88h-.001a.502.502 0 0 1 .584.5V5.81h-4v7h4v1.67a.5.5 0 0 1-.316.476l-.083.024-16.699 3.34.196.98.661-.132a.98.98 0 0 1 .241.64v.002a1 1 0 0 1-.577.906l-.52.104.097.49v.5c.248 0 .49-.046.718-.134l9.337-1.867c.229-.007.453-.052.663-.133l4.337-.867c.229-.007.453-.052.663-.133l4.38-.876-.196-.98-2.997.6a2 2 0 0 0-.097-1.461 1.5 1.5 0 0 0 1.189-1.368l.003-.13V4.47a1.5 1.5 0 0 0-1.103-1.462m-1.474 14.706a1 1 0 0 0 .577-.906v-.001a.97.97 0 0 0-.24-.64l-1.71.341a1 1 0 0 0-.05.306 1 1 0 0 0 .958.993zm-1.947.389a2 2 0 0 1-.476-1.295v-.006l.004-.085-1.196.24a1.97 1.97 0 0 1 .097 1.46zm-3.053.61a1 1 0 0 0 .577-.905v-.001a.97.97 0 0 0-.24-.64l-1.71.34a1 1 0 0 0-.05.307 1 1 0 0 0 .958.993zm-1.947.39a2 2 0 0 1-.476-1.295v-.006l.004-.085-6.197 1.24a1.97 1.97 0 0 1 .098 1.46zM19.1 4.462l.533.008H19.6zm-.21 11.462-.09-.454-.076-.377zm.21-4.114v-5h-3v5zm-6 2v-7h-5v7zm-1-1h-3v-5h3zm-6-5v7h-4v-1h3v-5h-3v-1z\" clip-rule=\"evenodd\"/>",
"moon": "<path fill=\"currentColor\" d=\"M9.49 6.521c-.722 1.988-.054 4.473 1.54 6.245 1.577 1.751 4 2.737 6.731 1.811l1.997-.677-1.481 1.501c-1.859 1.885-3.864 2.643-5.73 2.573-1.858-.07-3.517-.957-4.695-2.25-1.177-1.29-1.897-3.009-1.85-4.779.048-1.784.875-3.579 2.714-4.99l1.361-1.046zM8.212 7.815c-.816.994-1.181 2.088-1.21 3.157-.04 1.483.565 2.957 1.588 4.079 1.022 1.12 2.438 1.865 3.993 1.924 1.1.04 2.297-.262 3.506-1.055-2.346.138-4.39-.917-5.802-2.485-1.39-1.545-2.204-3.63-2.075-5.62\"/>",
"taxi-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M13 6h.586a1.5 1.5 0 0 1 1.06.44L18.208 10H20.5a1.5 1.5 0 0 1 1.5 1.5V16h-3.05a2.502 2.502 0 0 1-4.9 0h-5.1a2.502 2.502 0 0 1-4.9 0H2v-5.124c0-.363.132-.715.371-.988l2.954-3.375A1.5 1.5 0 0 1 6.455 6H7V4h6zM8 6V5h4v1zm-3.95 9a2.502 2.502 0 0 1 4.9 0h5.1a2.502 2.502 0 0 1 4.9 0H21v-3.5a.5.5 0 0 0-.5-.5H3v4zm-.448-5H9V7H6.454a.5.5 0 0 0-.377.17zM10 7v3h6.793L13.94 7.146A.5.5 0 0 0 13.586 7zm-2 8.5a1.5 1.5 0 1 0-3.002.001A1.5 1.5 0 0 0 8 15.499m10 0a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 18 15.499\" clip-rule=\"evenodd\"/>",
"train-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M10.277 3.084 13.901 5.5 11.652 7H14c2.051 0 3.793 1.24 4.563 3v.001q.075.17.137.349l.003.008.003.009 2.099 5.789c.118.25.195.534.195.843a2 2 0 0 1-2 2h-2.05c-.075.37-.232.71-.45 1H22v1H2v-1h1.5a2.5 2.5 0 0 1-.45-1H2v-1h17a1 1 0 0 0 1-1 1 1 0 0 0-.108-.44l-.012-.024-.01-.026-.547-1.51H13V10h4.445A3.97 3.97 0 0 0 14 8H2V7h6.348l-2.25-1.5 3.625-2.416.277-.185zM17.872 11H14v3h4.96zm-5.822 8c.075.369.232.709.45 1h-5c.218-.291.375-.631.45-1zm-7.965 0h2.83a1.502 1.502 0 0 1-2.83 0m9 0a1.502 1.502 0 0 0 2.83 0zM7.901 5.5 10 6.898 12.099 5.5 10 4.1zM12 10v5H7v-5zm-4 4h3v-3H8zm-2 1v-5H2v1h3v3H2v1z\" clip-rule=\"evenodd\"/>",
"tram-profile": "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M22 4V3H2v1h6.293l3 3H2v1h12.806a1.5 1.5 0 0 1 1.32.79l2.694 5.003c.118.218.18.463.18.71V18.5a.5.5 0 0 1-.5.5H2v1h1.05a2.5 2.5 0 0 0 .45 1H2v1h20v-1h-8.5c.222-.296.376-.638.45-1h4.55a1.5 1.5 0 0 0 1.5-1.5v-3.996a2.5 2.5 0 0 0-.299-1.185l-2.694-5.005A2.5 2.5 0 0 0 14.806 7h-2.099l-3-3zM9.5 21h-2a2.5 2.5 0 0 0 .45-1h1.1a2.5 2.5 0 0 0 .45 1m.586-1a1.5 1.5 0 0 0 2.828 0zm-6 0h2.828a1.5 1.5 0 0 1-2.828 0M5 9v6H2v-1h2v-4H2V9zm7 6V9H6v6zm-1-1H7v-4h4zm3.809-5 .138.276L18 15.382V17h-5V9zM14 16h3v-.382L14.191 10H14z\" clip-rule=\"evenodd\"/>"
};

// Verkehrsmittel: Schlüssel → [Bezeichnung, Piktogramm, Akzentfarbe des Piktogramms]
const MOTS = {
  bus: ['Bus', 'bus-profile', '#1a1a19'],
  rufbus: ['Rufbus', 'taxi-profile', '#1a1a19'],
  night: ['Nachtlinie (N)', 'moon', '#1f2a5c'],
  tram: ['Tram', 'tram-profile', '#1a1a19'],
  train: ['S-Bahn / Zug', 'train-profile', '#1a1a19'],
  ship: ['Schiff', 'boat-profile', '#1a1a19'],
  funi: ['Standseilbahn', 'funicular-profile', '#1a1a19'],
  cable: ['Luftseilbahn', 'cable-car-profile', '#1a1a19'],
};
const icon = (k, s = 16) => `<svg class="picto" viewBox="0 0 24 24" width="${s}" height="${s}" style="color:${MOTS[k][2]}" aria-hidden="true">${SBB_ICONS[MOTS[k][1]]}</svg>`;
function lineMot(l) {
  const c = l.cat || '', n = l.meta.line || '';
  if (c === 'BN' || /^N\d/.test(n)) return 'night';
  if (c === 'T') return 'tram';
  if (c === 'FUN') return 'funi';
  if (/^(PB|GB|SL|LB)$/.test(c)) return 'cable';
  if (/^(BAT|SCH|Schiff|FAE)$/i.test(c)) return 'ship';
  if (c === 'RUB') return 'rufbus';
  if (/^(S|IR|RE|R|IC|EC|EXT|S-Bahn|Zug)/.test(c)) return 'train';
  return 'bus';
}
const segClass = m => (MAP_CLASSES.find(c => c[2](m)) || ['none'])[0];
const stageList = m => ['ref', ...STAGES].map(k => `${m & M.bits[k] ? '✓' : '✗'} ${esc(sname(k))}`).join('<br>');
async function viewMap() {
  $('#main').innerHTML = '<p class="loading">Lade Karte …</p>';
  await ensureLeaflet();
  if (!M) {
    M = await (await fetch('data/map.json')).json();
    const byId = Object.fromEntries(S.lines.map(l => [l.id, l]));
    M.lines.forEach(l => { l.meta = byId[l.id] || { op: '?', line: l.id }; l.cls = [...new Set(l.m.map(segClass))]; l.mot = lineMot(l); });
  }
  const ops = [...new Set(M.lines.map(l => l.meta.op))].sort();
  const cnt = {}; M.lines.forEach(l => l.m.forEach(m => { const c = segClass(m); cnt[c] = (cnt[c] || 0) + 1; }));
  $('#main').innerHTML = `<div class="card"><h2>Karte</h2>
    <p class="muted small">Je Linie der längste Fahrweg (aus der Referenz, sonst aus dem neuesten Stand), als Luftlinie von Halt zu Halt.
      Jeder Abschnitt ist danach eingefärbt, in welchen Datenständen eine Fahrt der Linie ihn befährt. Abschnitt anklicken für Details und Link zur Fahrtenmatrix.</p>
    <div class="toolbar">
      <input type="search" id="mq" placeholder="Linie suchen" value="${esc(mstate.q)}">
      <label>Betreiber <select id="mop"><option value="">alle</option>${ops.map(o => `<option ${o === mstate.op ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <span class="muted small" id="mcnt"></span>
    </div>
    <div class="legend" id="mleg">${MAP_CLASSES.map(([k, l]) => `<label><input type="checkbox" data-k="${k}" ${mstate.show[k] ? 'checked' : ''}><i class="sw c-${k}"></i>${esc(l)} <span class="muted">(${fmt(cnt[k] || 0)})</span></label>`).join('')}</div>
    <div class="legend"><span><i class="term"></i> Start / Ziel der Linie</span><span class="muted">· Rahmen der Beschriftung = schlechtester Abschnitt der Linie · Beschriftung anklicken öffnet die Fahrtenmatrix · Verkehrsmittel-Filter oben rechts in der Karte</span></div>
    <div id="lmap"></div></div>`;
  if (lmap) { lmap.remove(); lmap = null; }
  lmap = L.map('lmap', { preferCanvas: true }).setView([47.38, 8.6], 10);
  setTimeout(() => lmap && lmap.invalidateSize(), 0);
  // Helle, schlichte Grundkarte (Esri Light Gray Canvas + dezente Ortsnamen); Ersatz bei Ausfall: OSM aufgehellt
  const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const base = L.tileLayer(esri + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 16, className: 'basemap-light',
    attribution: 'Grundkarte &copy; Esri, HERE, Garmin, &copy; OpenStreetMap' }).addTo(lmap);
  let tileErr = 0;
  base.on('tileerror', () => {
    if (++tileErr === 4) { base.remove(); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'basemap', attribution: osmAttr }).addTo(lmap); }
  });
  const renderer = L.canvas({ padding: 0.5, tolerance: 6 });
  // Linienbeschriftung: Symbol + Nummer, ohne Überlappung (wichtige Linien zuerst)
  let labels = [];
  const labelLayer = L.layerGroup().addTo(lmap);
  const placeLabels = () => {
    labelLayer.clearLayers();
    const size = lmap.getSize(), placed = [];
    for (const lb of labels) {
      const pt = lmap.latLngToContainerPoint(lb.ll);
      const w = lb.w, h = 24, r = { x0: pt.x - w / 2, y0: pt.y - h / 2, x1: pt.x + w / 2, y1: pt.y + h / 2 };
      if (r.x1 < 0 || r.y1 < 0 || r.x0 > size.x || r.y0 > size.y) continue;
      if (placed.some(p => r.x0 < p.x1 + 3 && r.x1 > p.x0 - 3 && r.y0 < p.y1 + 3 && r.y1 > p.y0 - 3)) continue;
      placed.push(r);
      L.marker(lb.ll, { icon: L.divIcon({ className: 'lbl-wrap', html: lb.html, iconSize: [w, h], iconAnchor: [w / 2, h / 2] }), keyboard: false })
        .bindTooltip(lb.tip, { direction: 'top', offset: [0, -10] })
        .on('click', () => go('fahrten', { linie: lb.id })).addTo(labelLayer);
    }
  };
  lmap.on('moveend', placeLabels);
  const draw = () => {
    if (mlayer) mlayer.remove();
    mlayer = L.layerGroup().addTo(lmap);
    labels = [];
    const q = mstate.q.toLowerCase();
    const sel = M.lines.filter(l => (!mstate.op || l.meta.op === mstate.op) && mstate.mot[l.mot] !== false &&
      (!q || (l.meta.op + ' ' + l.meta.line).toLowerCase().includes(q)) && l.cls.some(c => mstate.show[c]));
    const order = ['ok', 'extra', 'time', 'days', 'missing'];     // Probleme oben zeichnen
    const bounds = [];
    for (const cls of order) {
      if (!mstate.show[cls]) continue;
      for (const l of sel) {
        let run = null;
        const flush = () => {
          if (!run) return;
          const pts = run.stops.map(u => M.stops[u]).map(s => [s[0], s[1]]);
          bounds.push(...pts);
          const pl = L.polyline(pts, { renderer, color: MAP_COLORS[cls], weight: cls === 'ok' ? 3 : 4, opacity: cls === 'ok' ? 0.55 : 0.9 }).addTo(mlayer);
          const a = M.stops[run.stops[0]][2], b = M.stops[run.stops[run.stops.length - 1]][2];
          pl.bindTooltip(`<b>${esc(l.meta.op)} ${esc(l.meta.line)}</b><br>${esc(a)} – ${esc(b)}<br>${stageList(run.m)}`, { sticky: true });
          pl.bindPopup(`<b>${esc(l.meta.op)} ${esc(l.meta.line)}</b><br>${esc(a)} – ${esc(b)}<br>${stageList(run.m)}<br><a href="#fahrten?linie=${encodeURIComponent(l.id)}">Fahrtenmatrix öffnen</a>`);
          run = null;
        };
        l.m.forEach((m, i) => {
          if (segClass(m) !== cls) { flush(); return; }
          if (run && run.m === m) run.stops.push(l.p[i + 1]);
          else { flush(); run = { m, stops: [l.p[i], l.p[i + 1]] }; }
        });
        flush();
      }
    }
    const rank = { missing: 0, days: 1, time: 2, extra: 3, ok: 4 };
    for (const l of sel) {
      const shown = l.cls.filter(c => mstate.show[c]);
      if (!shown.length) continue;
      const worst = shown.sort((a, b) => rank[a] - rank[b])[0];
      const s = M.stops[l.p[Math.floor(l.p.length / 2)]];
      const mk = l.mot;
      const txt = l.meta.line;
      const a = M.stops[l.p[0]], b = M.stops[l.p[l.p.length - 1]];
      // Start und Ziel des längsten Fahrwegs
      for (const [st, role] of [[a, 'Start'], [b, 'Ziel']]) {
        L.circleMarker([st[0], st[1]], { renderer, radius: 4, color: '#1a1a19', weight: 2, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(`<b>${esc(l.meta.op)} ${esc(txt)}</b> · ${role}<br>${esc(st[2])}`).addTo(mlayer);
      }
      labels.push({ id: l.id, ll: [s[0], s[1]], rank: rank[worst], line: txt, w: 36 + 7.5 * txt.length,
        tip: `<b>${esc(l.meta.op)} ${esc(txt)}</b> · ${esc(MOTS[mk][0])}<br>${esc(a[2])} → ${esc(b[2])}`,
        html: `<span class="lbl" style="border-color:${MAP_COLORS[worst]}">${icon(mk, 20)}${esc(txt)}</span>` });
    }
    labels.sort((a, b) => a.rank - b.rank || a.line.localeCompare(b.line, 'de', { numeric: true }));
    $('#mcnt').textContent = `${fmt(sel.length)} Linien`;
    if ((mstate.q || mstate.op) && bounds.length) lmap.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 });
    placeLabels();
  };
  $('#mq').oninput = e => { mstate.q = e.target.value; draw(); };
  $('#mop').onchange = e => { mstate.op = e.target.value; draw(); };
  // Filter je Verkehrsmittel oben rechts in der Karte
  const motCount = {};
  M.lines.forEach(l => { motCount[l.mot] = (motCount[l.mot] || 0) + 1; });
  const MotCtl = L.Control.extend({ options: { position: 'topright' }, onAdd() {
    const div = L.DomUtil.create('div', 'motctl');
    div.innerHTML = `<b>Verkehrsmittel</b>${Object.keys(MOTS).filter(k => motCount[k]).map(k =>
      `<label><input type="checkbox" data-mot="${k}" ${mstate.mot[k] !== false ? 'checked' : ''}>${icon(k, 18)}<span>${esc(MOTS[k][0])}</span><span class="muted">${fmt(motCount[k])}</span></label>`).join('')}
      <div class="motbtn"><button type="button" data-all="1">alle</button><button type="button" data-all="0">keine</button></div>`;
    L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
    div.querySelectorAll('input').forEach(cb => cb.onchange = () => { mstate.mot[cb.dataset.mot] = cb.checked; draw(); });
    div.querySelectorAll('button').forEach(b => b.onclick = () => {
      const on = b.dataset.all === '1';
      div.querySelectorAll('input').forEach(cb => { cb.checked = on; mstate.mot[cb.dataset.mot] = on; }); draw();
    });
    return div;
  } });
  new MotCtl().addTo(lmap);
  document.querySelectorAll('#mleg input').forEach(cb => cb.onchange = () => { mstate.show[cb.dataset.k] = cb.checked; draw(); });
  draw();
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
