"""Vergleich DINO → NeRED V2 → INFO+ ZVV gegen die Referenz «Gesamt 2027».

Aufruf:
    python tools/build_compare.py --base "<Ordner mit den vier Datenständen>" --out docs/data

Erwartete Unterordner in --base:
    DINO_2_3_*            DINO-Export ZVV
    ZVV 2027 NeRED V2     HRDF aus NeRED
    ZVV 2027              HRDF aus INFO+ (ZVV-Teil)
    Gesamt 2027           HRDF Gesamtexport INFO+ (Referenz)

Vergleichseinheit ist der *Fahrtag*: eine Fahrt (SJYID) an einem Verkehrstag.
Für jede Stufe und jede Referenzfahrt wird pro Verkehrstag festgestellt, ob die
Fahrt vorhanden ist und ob Halte und Zeiten übereinstimmen.
"""
import argparse
import collections as C
import datetime as dt
import glob
import hashlib
import json
import os
import pickle
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from parse_sources import (ALL, HRDF_INFO, HRDF_NERED, NDAYS, START, parse_dino,  # noqa: E402
                           parse_hrdf)

STAGES = [
    {'id': 'dino', 'label': 'DINO ZVV', 'short': 'DINO', 'desc': 'Quelle ZVV (DINO 2.3)'},
    {'id': 'nered', 'label': 'NeRED V2', 'short': 'NeRED', 'desc': 'HRDF aus NeRED'},
    {'id': 'info', 'label': 'INFO+ ZVV', 'short': 'INFO+', 'desc': 'HRDF aus INFO+ (neu, ZVV-Teil)'},
]
REF = {'id': 'ref', 'label': 'Gesamt 2027', 'short': 'Referenz', 'desc': 'INFO+ Gesamtexport (bisher an OJP)'}

# Klassen je Fahrtag
CLASSES = ['ok', 'tol', 'time', 'stops', 'missing']   # gegenüber Referenz
# ok: identisch · tol: Zeiten max. ±1 Min · time: Zeiten > 1 Min · stops: Halte anders · missing: fehlt
EXTRA = 'extra'                                       # Tag nicht in Referenz


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def popcount(x):
    return bin(x).count('1')


def tohex(mask):
    return format(mask, 'x')


# ------------------------------------------------------------------ Laden
def load(base, cache):
    os.makedirs(cache, exist_ok=True)

    def cached(name, fn):
        p = os.path.join(cache, name + '.pkl')
        if os.path.exists(p):
            with open(p, 'rb') as f:
                return pickle.load(f)
        v = fn()
        with open(p, 'wb') as f:
            pickle.dump(v, f, protocol=pickle.HIGHEST_PROTOCOL)
        return v

    dino_dir = sorted(glob.glob(os.path.join(base, 'DINO_*')))[-1]
    data = {}
    data['dino'] = cached('dino', lambda: parse_dino(dino_dir))
    log('DINO', len(data['dino'][0]))
    data['nered'] = cached('nered', lambda: parse_hrdf(os.path.join(base, 'ZVV 2027 NeRED V2'), HRDF_NERED))
    log('NeRED', len(data['nered'][0]))
    data['info'] = cached('info', lambda: parse_hrdf(os.path.join(base, 'ZVV 2027'), HRDF_INFO))
    log('INFO+', len(data['info'][0]))
    union = {t['sj'] for k in ('dino', 'nered', 'info') for t in data[k][0] if t['sj']}
    orgs = {sj.split(':')[3] for sj in union}
    data['ref'] = cached('gesamt', lambda: parse_hrdf(
        os.path.join(base, 'Gesamt 2027'), HRDF_INFO,
        keep=lambda sj, adm: bool(sj) and (sj in union or sj.split(':')[3] in orgs),
        progress=lambda n: log('Gesamt', n)))
    log('Gesamt (vorgefiltert)', len(data['ref'][0]))
    return data, dino_dir


def org_names(base):
    names = {}
    cur = None
    with open(os.path.join(base, 'Gesamt 2027', 'BETRIEB_DE'), encoding='utf-8', errors='replace') as f:
        for line in f:
            m = re.match(r'(\d+) K "([^"]*)" L "([^"]*)" V "([^"]*)"', line)
            if m:
                cur = (m.group(2), m.group(4))
                continue
            m = re.match(r'\d+ N "ch:1:sboid:(\d+)"', line)
            if m and cur:
                names.setdefault(m.group(1), cur)
    return names


def eckdaten(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            rows = [r.strip() for r in f if r.strip()]
        txt = rows[2] if len(rows) > 2 else ''
        parts = txt.split('$')
        return parts[1] if len(parts) > 1 else txt
    except OSError:
        return ''


# ------------------------------------------------------------------ Vergleich
def same_stops(a, b):
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x[0] != y[0] and not (x[0].startswith('D') or y[0].startswith('D')):
            return False
    return True


def classify(sig_r, sig_s):
    if sig_r == sig_s:
        return 'ok'
    if not same_stops(sig_r, sig_s):
        return 'stops'
    dmax = 0
    for x, y in zip(sig_r, sig_s):
        for i in (1, 2):
            if x[i] is None or y[i] is None:
                continue
            dmax = max(dmax, abs(x[i] - y[i]))
    if dmax == 0:
        return 'ok'      # nur Unterschiede in Halten ohne SLOID / fehlenden Zeiten
    return 'tol' if dmax <= 1 else 'time'


def variants(trips):
    """Fasst Datensätze derselben SJYID zu (Signatur → Tagesmaske) zusammen."""
    v = {}
    for t in trips:
        sig = tuple(t['stops'])
        v[sig] = v.get(sig, 0) | t['days']
    return v


def compare_trip(ref_v, st_v):
    res = {c: 0 for c in CLASSES}
    res[EXTRA] = 0
    rdays = 0
    for m in ref_v.values():
        rdays |= m
    sdays = 0
    for m in st_v.values():
        sdays |= m
    res['missing'] = rdays & ~sdays
    res[EXTRA] = sdays & ~rdays
    done = 0
    order = {'ok': 0, 'tol': 1, 'time': 2, 'stops': 3}
    pairs = []
    for rs, rm in ref_v.items():
        for ss, sm in st_v.items():
            o = rm & sm
            if o:
                pairs.append((order[classify(rs, ss)], o))
    pairs.sort(key=lambda p: p[0])     # bester Treffer gewinnt je Tag
    names = ['ok', 'tol', 'time', 'stops']
    for k, o in pairs:
        o &= ~done
        if o:
            res[names[k]] |= o
            done |= o
    return res


def trip_status(counts, in_ref, in_stage, carrier=0):
    if not in_stage:
        return 'merged' if counts.get('merged') and not counts['missing'] else 'missing'
    if not in_ref:
        return 'merged' if carrier and not counts['extra'] else 'extra'
    if counts['stops']:
        return 'stops'
    if counts['missing']:
        return 'days'
    if counts['time']:
        return 'time'
    if counts['extra']:
        return 'days'
    if counts.get('merged') or carrier:
        return 'merged'
    if counts['tol']:
        return 'tol'
    return 'ok'


def build(base, out, cache):
    data, dino_dir = load(base, cache)
    orgn = org_names(base)
    stopnames = {}
    for k in ('dino', 'nered', 'info', 'ref'):
        for u, n in data[k][1].items():
            if n and (u not in stopnames or k == 'ref'):
                stopnames[u] = n
    dino_stops = {s[0] for t in data['dino'][0] for s in t['stops']}

    # --- Referenz-Umfang bestimmen
    union = {t['sj'] for k in ('dino', 'nered', 'info') for t in data[k][0] if t['sj']}
    ref_by = C.defaultdict(list)
    scope_reason = {}
    for t in data['ref'][0]:
        sj = t['sj']
        if sj in union:
            ref_by[sj].append(t)
            scope_reason[sj] = 'id'
        else:
            inside = sum(1 for s in t['stops'] if s[0] in dino_stops)
            if inside >= 2 and inside * 2 >= len(t['stops']):
                ref_by[sj].append(t)
                scope_reason.setdefault(sj, 'area')
    log('Referenzfahrten im ZVV-Umfang', len(ref_by),
        C.Counter(scope_reason.values()))

    # --- Stufen gruppieren, Fahrten ohne SJYID über Laufweg zuordnen
    def tkey(t):
        st = t['stops']
        return (st[0][0], st[0][2], st[-1][0], st[-1][1]) if len(st) >= 2 else None

    def in_area(t):
        inside = sum(1 for s in t['stops'] if s[0] in dino_stops)
        return inside >= 2 and inside * 2 >= len(t['stops'])

    ref_key = C.defaultdict(list)
    for t in data['ref'][0]:
        k = tkey(t)
        if k:
            ref_key[k].append((t['sj'], t['days']))
    by = {}
    nosj = {}
    for st in STAGES:
        k = st['id']
        g = C.defaultdict(list)
        no = C.Counter()
        for t in data[k][0]:
            sj = t['sj']
            if not sj:
                if k == 'info' and not in_area(t):
                    no['outside'] += 1      # INFO+-Export enthält auch PostAuto ausserhalb ZVV
                    continue
                cand = ref_key.get(tkey(t), [])
                best = max(cand, key=lambda c: popcount(c[1] & t['days']), default=None)
                if best and best[1] & t['days']:
                    sj = best[0]
                    no['matched'] += 1
                else:
                    sj = 'nosj:%s:%s:%s' % (t['adm'], t['nr'], tkey(t))
                    no['unmatched'] += 1
                t = dict(t, nosj=True)
            g[sj].append(t)
        by[k] = g
        nosj[k] = dict(no)
        log(k, 'Fahrten', len(g), 'ohne SJYID', dict(no))
    # Referenzfahrten nachtragen, die erst über den Laufweg zugeordnet wurden
    need = {sj for k in by for sj in by[k] if sj.startswith('ch:') and sj not in ref_by}
    for t in data['ref'][0]:
        if t['sj'] in need:
            ref_by[t['sj']].append(t)
            scope_reason.setdefault(t['sj'], 'id')
    for sj in [sj for sj, v in ref_by.items() if not v]:
        del ref_by[sj]
    by['ref'] = ref_by

    # --- Neu vergebene SJYID: gleiche Fahrt (Laufweg/Zeiten) unter anderer ID
    remapped = {}
    for st in STAGES:
        k = st['id']
        idx = C.defaultdict(list)
        for sj, ts in ref_by.items():
            if sj in by[k]:
                continue
            for t in ts:
                key = tkey(t)
                if key:
                    idx[key].append((sj, t['days']))
        used = set()
        moves = []
        for sj, ts in by[k].items():
            if sj in ref_by:
                continue
            days = 0
            for t in ts:
                days |= t['days']
            cand = C.Counter()
            for t in ts:
                for rsj, rd in idx.get(tkey(t), []):
                    if rsj not in used:
                        cand[rsj] += popcount(rd & days)
            if cand:
                rsj, ov = cand.most_common(1)[0]
                if ov:
                    used.add(rsj)
                    moves.append((sj, rsj))
        for sj, rsj in moves:
            by[k][rsj] = [dict(t, sjold=sj) for t in by[k].pop(sj)]
        remapped[k] = len(moves)
        log(k, 'SJYID neu vergeben, über Laufweg zugeordnet:', len(moves))

    # --- Universum
    universe = set(ref_by)
    for st in STAGES:
        universe |= set(by[st['id']])

    # Linienzuordnung
    def meta_of(sj):
        for k in ('ref', 'info', 'nered', 'dino'):
            ts = by[k].get(sj)
            if ts:
                t = ts[0]
                org = sj.split(':')[3] if sj.startswith('ch:') else ''
                op = orgn.get(org, (t['op'], t['op']))[0] if org else t['op']
                line = t['line']
                if not line:
                    for k2 in ('ref', 'info', 'nered', 'dino'):
                        for t2 in by[k2].get(sj, []):
                            if t2['line']:
                                line = t2['line']
                                break
                        if line:
                            break
                return op or '?', line or '?', t['cat'], org
        return '?', '?', '', ''

    cats = {}
    lines = {}
    trips_out = C.defaultdict(list)
    cal = {k: [0] * NDAYS for k in ['ref'] + [s['id'] for s in STAGES]}
    tot = {s['id']: C.Counter() for s in STAGES}
    totd = {s['id']: C.Counter() for s in STAGES}
    ref_tot = C.Counter()
    pair_tot = {}
    # Stufenvergleich in der Kette (Vorstufe als Basis)
    chain = [('dino', 'nered'), ('nered', 'info'), ('info', 'ref')]
    for a, b in chain:
        pair_tot[a + '>' + b] = C.Counter()

    log('Vergleiche', len(universe), 'Fahrten')
    vcache = {}

    def V(k, sj):
        key = (k, sj)
        if key not in vcache:
            vcache[key] = variants(by[k].get(sj, []))
        return vcache[key]

    for n, sj in enumerate(sorted(universe)):
        op, line, cat, org = meta_of(sj)
        lid = op + ' · ' + line
        L = lines.get(lid)
        if L is None:
            L = lines[lid] = {'id': lid, 'op': op, 'line': line, 'cats': C.Counter(),
                              'ref': {'trips': 0, 'days': 0},
                              'st': {s['id']: {'trips': C.Counter(), 'days': C.Counter()} for s in STAGES},
                              'chain': {a + '>' + b: C.Counter() for a, b in chain}}
        L['cats'][cat] += 1
        rv = V('ref', sj)
        rdays = 0
        for m in rv.values():
            rdays |= m
        in_ref = bool(rv)
        if in_ref:
            L['ref']['trips'] += 1
            L['ref']['days'] += popcount(rdays)
            ref_tot['trips'] += 1
            ref_tot['days'] += popcount(rdays)
            for i in range(NDAYS):
                if rdays >> i & 1:
                    cal['ref'][i] += 1
        rec = {'sj': sj, 'r': tohex(rdays) if in_ref else '', 'st': {}}
        first = None
        for k in ('ref', 'info', 'nered', 'dino'):
            ts = by[k].get(sj)
            if ts:
                t0 = min(ts, key=lambda t: popcount(t['days']) * -1)
                if t0['stops']:
                    first = t0
                break
        if first:
            rec['dep'] = first['stops'][0][2]
            rec['from'] = first['stops'][0][0]
            rec['to'] = first['stops'][-1][0]
            rec['dir'] = first.get('dir', '')
        rec['nr'] = {k: sorted({t['nr'] for t in by[k].get(sj, [])})[:3] for k in ('ref', 'info', 'nered', 'dino') if by[k].get(sj)}
        for s in STAGES:
            k = s['id']
            sv = V(k, sj)
            in_st = bool(sv)
            if in_ref:
                c = compare_trip(rv, sv) if in_st else {**{x: 0 for x in CLASSES}, 'missing': rdays, EXTRA: 0}
            else:
                sd = 0
                for m in sv.values():
                    sd |= m
                c = {**{x: 0 for x in CLASSES}, EXTRA: sd}
            c['merged'] = 0
            c['mergedx'] = 0
            rec.setdefault('_c', {})[k] = (c, in_ref, in_st)
            sd = 0
            for m in sv.values():
                sd |= m
            for i in range(NDAYS):
                if sd >> i & 1:
                    cal[k][i] += 1
            rec['st'][k] = {}
            nos = any(t.get('nosj') for t in by[k].get(sj, []))
            if nos:
                rec['st'][k]['nosj'] = 1
            old = sorted({t['sjold'] for t in by[k].get(sj, []) if t.get('sjold')})
            if old:
                rec['st'][k]['sjold'] = old[0]
        # Kette
        for a, b in chain:
            av, bv = V(a, sj), V(b, sj)
            if not av and not bv:
                continue
            if av and bv:
                c = compare_trip(av, bv)
                st = trip_status({x: popcount(v) for x, v in c.items()}, True, True)
            elif av:
                st = 'missing'
            else:
                st = 'extra'
            pair_tot[a + '>' + b][st] += 1
            L['chain'][a + '>' + b][st] += 1
        # Detaildaten (Varianten) je Stufe
        rec['v'] = {}
        for k in ['ref'] + [s['id'] for s in STAGES]:
            vv = V(k, sj)
            if vv:
                rec['v'][k] = [[[list(x) for x in sig], tohex(m)] for sig, m in vv.items()]
        trips_out[lid].append(rec)
        if n % 20000 == 0:
            log(n)

    # --- Gleicher Fahrplan unter anderer SJYID (z. B. INFO+ legt identische Fahrten zusammen)
    def iterbits(x):
        while x:
            low = x & -x
            yield low.bit_length() - 1
            x ^= low
    merged_tot = C.Counter()
    for lid, recs in trips_out.items():
        L = lines[lid]
        for s_ in STAGES:
            k = s_['id']
            pool = C.defaultdict(list)
            for rec in recs:
                c = rec['_c'][k][0]
                if c[EXTRA]:
                    for sig, m in V(k, rec['sj']).items():
                        for d in iterbits(m & c[EXTRA]):
                            pool[(d, sig)].append(c)
            if pool:
                for rec in recs:
                    c = rec['_c'][k][0]
                    if not c['missing']:
                        continue
                    for sig, m in V('ref', rec['sj']).items():
                        for d in iterbits(m & c['missing']):
                            lst = pool.get((d, sig))
                            if lst:
                                other = lst.pop()
                                bit = 1 << d
                                c['missing'] &= ~bit
                                c['merged'] |= bit
                                other[EXTRA] &= ~bit
                                other['mergedx'] |= bit
            for rec in recs:
                c, in_ref, in_st = rec['_c'][k]
                cnt = {x: popcount(c[x]) for x in CLASSES + [EXTRA, 'merged']}
                status = trip_status(cnt, in_ref, in_st, popcount(c['mergedx']))
                L['st'][k]['trips'][status] += 1
                tot[k][status] += 1
                for x, v in cnt.items():
                    L['st'][k]['days'][x] += v
                    totd[k][x] += v
                rec['st'][k].update({'s': status, 'c': {x: v for x, v in cnt.items() if v}})
                if c['merged']:
                    rec['st'][k]['m'] = tohex(c['merged'])
                if c['mergedx']:
                    rec['st'][k]['mx'] = tohex(c['mergedx'])
        for rec in recs:
            del rec['_c']

    # --- Ausgabe
    os.makedirs(os.path.join(out, 'lines'), exist_ok=True)
    for f in glob.glob(os.path.join(out, 'lines', '*.json')):
        os.remove(f)
    line_list = []
    for lid, L in lines.items():
        fname = hashlib.sha1(lid.encode('utf-8')).hexdigest()[:12]
        trs = sorted(trips_out[lid], key=lambda r: (r.get('dep') if r.get('dep') is not None else 99999, r['sj']))
        used = set()
        for r in trs:
            for vs in r['v'].values():
                for sig, _ in vs:
                    for s in sig:
                        used.add(s[0])
        stop_list = sorted(used)
        sidx = {u: i for i, u in enumerate(stop_list)}
        pats = {}
        masks = {}

        def mi(h):
            if h not in masks:
                masks[h] = len(masks)
            return masks[h]
        for r in trs:
            ref_vs = {json.dumps(v) for v in r['v'].get('ref', [])}
            nv = {}
            for k, vs in r['v'].items():
                if k != 'ref' and vs and {json.dumps(v) for v in vs} == ref_vs:
                    nv[k] = '='          # identisch mit Referenz
                    continue
                arr = []
                for sig, m in vs:
                    pk = tuple(sidx[x[0]] for x in sig)
                    if pk not in pats:
                        pats[pk] = len(pats)
                    times = []
                    for x in sig:
                        times += [x[1], x[2]]
                    arr.append([pats[pk], times, mi(m)])
                nv[k] = arr
            r['v'] = nv
            r['r'] = mi(r['r']) if r['r'] else -1
            for st_ in r['st'].values():
                for kk in ('m', 'mx'):
                    if kk in st_:
                        st_[kk] = mi(st_[kk])
            if r.get('from'):
                r['from'] = sidx.get(r['from'], r['from'])
                r['to'] = sidx.get(r['to'], r['to'])
        with open(os.path.join(out, 'lines', fname + '.json'), 'w', encoding='utf-8') as f:
            json.dump({'id': lid, 'stops': [[u, stopnames.get(u, u)] for u in stop_list],
                       'pats': [list(p) for p in sorted(pats, key=pats.get)],
                       'masks': sorted(masks, key=masks.get), 'trips': trs},
                      f, ensure_ascii=False, separators=(',', ':'))
        line_list.append({'id': lid, 'f': fname, 'op': L['op'], 'line': L['line'],
                          'cat': L['cats'].most_common(1)[0][0] if L['cats'] else '',
                          'ref': L['ref'], 'n': len(trs),
                          'chain': {k: dict(v) for k, v in L['chain'].items()},
                          'st': {k: {'trips': dict(v['trips']), 'days': dict(v['days'])} for k, v in L['st'].items()}})
    line_list.sort(key=lambda x: (x['op'], natkey(x['line'])))
    base_name = os.path.basename(dino_dir)
    stages_meta = []
    for s in STAGES + [REF]:
        m = dict(s)
        if s['id'] == 'dino':
            m['date'] = re.sub(r'.*_(\d{4})-(\d\d)-(\d\d)T.*', r'\3.\2.\1', base_name)
        elif s['id'] == 'nered':
            m['date'] = time.strftime('%d.%m.%Y', time.localtime(os.path.getmtime(os.path.join(base, 'ZVV 2027 NeRED V2', 'fplan'))))
        elif s['id'] == 'info':
            m['date'] = eckdaten(os.path.join(base, 'ZVV 2027', 'ECKDATEN')).split()[0]
        else:
            m['date'] = eckdaten(os.path.join(base, 'Gesamt 2027', 'ECKDATEN')).split()[0]
        m['records'] = len(data[s['id']][0])
        stages_meta.append(m)
    summary = {
        'built': dt.datetime.now().strftime('%d.%m.%Y %H:%M'),
        'start': START.isoformat(), 'ndays': NDAYS,
        'stages': stages_meta,
        'ref': dict(ref_tot),
        'scope': dict(C.Counter(scope_reason.values())),
        'trips': {k: dict(v) for k, v in tot.items()},
        'days': {k: dict(v) for k, v in totd.items()},
        'chain': {k: dict(v) for k, v in pair_tot.items()},
        'nosj': nosj,
        'remapped': remapped,
        'calendar': cal,
        'lines': line_list,
    }
    with open(os.path.join(out, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, separators=(',', ':'))
    log('fertig', len(line_list), 'Linien')


def natkey(s):
    return [int(p) if p.isdigit() else p for p in re.split(r'(\d+)', s or '')]


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--base', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--cache', default='.cache')
    a = p.parse_args()
    build(a.base, a.out, a.cache)
