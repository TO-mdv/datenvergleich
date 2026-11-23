"""Parser für DINO 2.3 und HRDF (INFO+ / NeRED) in ein gemeinsames Fahrtmodell.

Jede Fahrt wird normalisiert zu:
    sj    SJYID (ch:1:sjyid:...)
    stops Liste von (UIC, Ankunft-Minute|None, Abfahrt-Minute|None)
    days  int-Bitmaske, Bit i = Tag i ab Fahrplanbeginn (13.12.2026), 364 Tage
    line  Linienbezeichnung (öffentlich), cat Verkehrsmittel, op Betreiber
    dir   Richtungstext (falls vorhanden)
"""
import csv
import datetime as dt
import re
from collections import defaultdict

START = dt.date(2026, 12, 13)
NDAYS = 364
ALL = (1 << NDAYS) - 1


def _hrdf_bits(hexstr):
    """HRDF-Bitfeld: zwei Füllbits vorne, danach Tag 0 .. n (MSB zuerst)."""
    n = len(hexstr) * 4
    v = int(hexstr, 16)
    out = 0
    for i in range(NDAYS):
        pos = n - 1 - (2 + i)
        if pos < 0:
            break
        if (v >> pos) & 1:
            out |= 1 << i
    return out


def _read(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            yield line.rstrip('\r\n')


def _time(field):
    s = field.strip()
    if not s:
        return None, False
    neg = s.startswith('-')
    s = s.lstrip('-')
    if not s.isdigit():
        return None, False
    v = int(s)
    return (v // 100) * 60 + v % 100, neg


def parse_hrdf(folder, names, keep=None, progress=None):
    """names: dict mit Dateinamen für fplan, bitfeld, infotext, betrieb, richtung, bahnhof.
    keep: optionale Funktion(sjyid)->bool zur Vorfilterung (für den grossen Gesamtexport)."""
    infotext = {}
    for line in _read(f'{folder}/{names["infotext"]}'):
        if 'sjyid' in line[:60]:
            infotext[line[:9]] = line[10:].strip()
    bits = {}
    for line in _read(f'{folder}/{names["bitfeld"]}'):
        p = line.split()
        if len(p) >= 2:
            bits[p[0]] = p[1]
    bitcache = {}
    operators = {}
    try:
        cur = None
        for line in _read(f'{folder}/{names["betrieb"]}'):
            m = re.match(r'(\d+) K "([^"]*)" L "([^"]*)" V "([^"]*)"', line)
            if m:
                cur = m.group(2) or m.group(3)
                continue
            m = re.match(r'\d+ : (.*)', line)
            if m and cur:
                for adm in m.group(1).split():
                    operators.setdefault(adm, cur)
    except FileNotFoundError:
        pass
    directions = {}
    try:
        for line in _read(f'{folder}/{names["richtung"]}'):
            if line.strip():
                directions[line[:7]] = line[8:].strip()
    except FileNotFoundError:
        pass
    stopnames = {}
    for line in _read(f'{folder}/{names["bahnhof"]}'):
        if len(line) > 12 and line[:7].isdigit():
            stopnames[line[:7]] = line[12:].split('$')[0].strip()

    trips = []
    cur = None

    def flush():
        if cur is None:
            return
        if keep is not None and not keep(cur['sj'], cur['adm']):
            return
        stops = [(u, a, d) for u, a, d in cur['stops'] if a is not None or d is not None]
        if cur['ve']:
            mask = 0
            for b in cur['ve']:
                if b is None:
                    mask = ALL
                    break
                if b not in bitcache:
                    bitcache[b] = _hrdf_bits(bits[b]) if b in bits else 0
                mask |= bitcache[b]
        else:
            mask = ALL
        trips.append({'sj': cur['sj'], 'stops': stops, 'days': mask, 'line': cur['line'],
                      'cat': cur['cat'], 'op': operators.get(cur['adm'], cur['adm']),
                      'adm': cur['adm'], 'nr': cur['nr'], 'dir': cur['dir'], 'tag': cur['tag']})

    n = 0
    for line in _read(f'{folder}/{names["fplan"]}'):
        if line.startswith('*Z'):
            flush()
            n += 1
            if progress and n % 200000 == 0:
                progress(n)
            p = line[:60].split()
            tag = line.split('%', 1)[1].strip() if '%' in line else ''
            cur = {'nr': p[1], 'adm': p[2], 'sj': None, 'stops': [], 've': [], 'line': '',
                   'cat': '', 'dir': '', 'tag': tag}
        elif cur is None:
            continue
        elif line.startswith('*'):
            kind = line[:2]
            body = line.split('%', 1)[0]
            if kind == '*A' and body[3:5] == 'VE':
                p = body[5:].split()
                cur['ve'].append(p[2] if len(p) >= 3 and p[2] != '000000' else None)
            elif kind == '*I' and body[3:5] == 'JY':
                p = body[5:].split()
                ref = p[-1] if p else ''
                cur['sj'] = infotext.get(ref)
            elif kind == '*G' and not cur['cat']:
                cur['cat'] = body[3:].split()[0] if body[3:].split() else ''
            elif kind == '*L' and not cur['line']:
                v = body[3:11].strip()
                cur['line'] = v[1:] if v.startswith('#') else v
            elif kind == '*R' and not cur['dir']:
                p = body[3:].split()
                if len(p) >= 2 and p[1].startswith('R'):
                    cur['dir'] = directions.get(p[1], p[1])
        else:
            if len(line) < 7 or not line[:7].isdigit():
                continue
            a, an = _time(line[29:35])
            d, dn = _time(line[36:42])
            cur['stops'].append((line[:7], a, d))
    flush()
    return trips, stopnames


HRDF_INFO = dict(fplan='FPLAN', bitfeld='BITFELD', infotext='INFOTEXT_DE', betrieb='BETRIEB_DE',
                 richtung='RICHTUNG', bahnhof='BAHNHOF')
HRDF_NERED = dict(fplan='fplan', bitfeld='bitfield', infotext='infotext_DE', betrieb='betrieb',
                  richtung='richtung', bahnhof='bahnhof')


# ---------------------------------------------------------------- DINO
def _csv(folder, name):
    with open(f'{folder}/{name}', encoding='cp1252', errors='replace', newline='') as f:
        r = csv.reader(f, delimiter=';')
        head = [h.strip() for h in next(r)]
        for row in r:
            if row:
                yield dict(zip(head, (x.strip() for x in row)))


def parse_dino(folder):
    date_index = {}
    for r in _csv(folder, 'day_type_calendar.din'):
        d = dt.date(int(r['DAY'][:4]), int(r['DAY'][4:6]), int(r['DAY'][6:8]))
        i = (d - START).days
        if 0 <= i < NDAYS:
            date_index.setdefault(r['DAY_TYPE_NR'], []).append(i)
    attr_days = defaultdict(int)
    for r in _csv(folder, 'day_type_2_day_attribute.din'):
        for i in date_index.get(r['DAY_TYPE_NR'], []):
            attr_days[r['DAY_ATTRIBUTE_NR']] |= 1 << i
    restr = {}
    for r in _csv(folder, 'service_restriction.din'):
        s = r['RESTRICTION_DAYS']
        start = dt.date(int(r['DATE_FROM'][:4]), int(r['DATE_FROM'][4:6]), 1)
        mask = 0
        for m in range(len(s) // 8):
            word = int(s[m * 8:m * 8 + 8], 16)
            y, mo = start.year + (start.month - 1 + m) // 12, (start.month - 1 + m) % 12 + 1
            for day in range(1, 32):
                if word >> (day - 1) & 1:
                    try:
                        i = (dt.date(y, mo, day) - START).days
                    except ValueError:
                        continue
                    if 0 <= i < NDAYS:
                        mask |= 1 << i
        restr[r['RESTRICTION']] = (mask, r['RESTRICT_TEXT1'])
    stops = {}
    stopnames = {}
    for r in _csv(folder, 'stop.din'):
        g = r['GLOBAL_ID']
        m = re.match(r'ch:1:sloid:(\d+)', g)
        uic = str(8500000 + int(m.group(1))) if m else 'D' + r['STOP_NR']
        stops[r['STOP_NR']] = uic
        stopnames[uic] = r['STOP_NAME']
    lines = {}
    for r in _csv(folder, 'line.din'):
        lines[(r['LINE_NR'], r['STR_LINE_VAR'])] = r
    ops = {r['OP_CODE']: r['OP_SHORT_NAME'] for r in _csv(folder, 'operator.din')}
    mots = {r['MOT_NR']: r['MOT_NAME'] for r in _csv(folder, 'means_of_transport_desc.din')}
    route = defaultdict(list)
    for r in _csv(folder, 'route.din'):
        route[(r['LINE_NR'], r['STR_LINE_VAR'], r['LINE_DIR_NR'])].append(
            (int(r['LINE_CONSEC_NR']), stops.get(r['STOP_NR'], 'D' + r['STOP_NR'])))
    for k in route:
        route[k].sort()
    timing = defaultdict(dict)
    for r in _csv(folder, 'timing_pattern.din'):
        timing[(r['LINE_NR'], r['STR_LINE_VAR'], r['LINE_DIR_NR'], r['TIMING_GROUP_NR'])][int(r['LINE_CONSEC_NR'])] = (
            int(r['TT_REL'] or 0), int(r['STOPPING_TIME'] or 0))
    trips = []
    for r in _csv(folder, 'trip.din'):
        key = (r['LINE_NR'], r['STR_LINE_VAR'], r['LINE_DIR_NR'])
        tp = timing[key + (r['TIMING_GROUP_NR'],)]
        t = int(r['DEPARTURE_TIME'])
        seq = []
        started = False
        dep_stop = stops.get(r['DEP_STOP_NR'])
        arr_stop = stops.get(r['ARR_STOP_NR'])
        clock = t
        for consec, uic in route[key]:
            rel, stop = tp.get(consec, (0, 0))
            if not started:
                if uic != dep_stop and seq == [] and any(u == dep_stop for _, u in route[key]):
                    # Teilfahrt: beginnt später im Linienweg
                    continue
                started = True
                arr = clock
            else:
                clock += rel
                arr = clock
            dep = arr + stop
            clock = dep
            seq.append([uic, arr, dep])
            if uic == arr_stop and len(seq) > 1:
                break
        if seq:
            seq[0][1] = None
            seq[-1][2] = None
        st = [(u, None if a is None else a // 60, None if d is None else d // 60) for u, a, d in seq]
        days = attr_days.get(r['DAY_ATTRIBUTE_NR'], 0)
        if r['RESTRICTION']:
            days &= restr.get(r['RESTRICTION'], (ALL, ''))[0]
        ln = lines.get((r['LINE_NR'], r['STR_LINE_VAR']), {})
        trips.append({'sj': r['GLOBAL_ID'], 'stops': st, 'days': days,
                      'line': ln.get('LINE_NAME', r['LINE_NR']),
                      'cat': mots.get(ln.get('MOT_NR', ''), ''),
                      'op': ops.get(ln.get('OP_CODE') or r['OP_CODE'], ln.get('OP_CODE', '')),
                      'adm': ln.get('OP_CODE', ''), 'nr': r['TRIP_ID'], 'dir': '',
                      'tag': f"{r['LINE_NR']}/{r['STR_LINE_VAR']}/{r['LINE_DIR_NR']}"})
    return trips, stopnames
