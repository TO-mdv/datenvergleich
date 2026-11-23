"""Compare source blocks by stable journey identity, retaining calendar variants."""
import datetime as dt
import json
from collections import defaultdict
from difflib import SequenceMatcher
from feature_compare import load_profiles,compare_fields

START = dt.date(2026, 12, 13)


def merge_stops(base, other):
    """Sequence alignment preserves repeated visits and changed route sections."""
    result = []
    for tag, a, b, c, d in SequenceMatcher(None, [s[0] for s in base], [s[0] for s in other], autojunk=False).get_opcodes():
        if tag == 'equal':
            result.extend(base[a:b])
        else:
            result.extend(base[a:b])
            result.extend(other[c:d])
    return result


def compare(db, q, stages):
    key = q.get('key', [''])[0]
    date = q.get('date', ['2026-12-14'])[0]
    direction = q.get('direction', [''])[0]
    offset = max(0, int(q.get('offset', ['0'])[0]))
    limit = min(120, max(1, int(q.get('limit', ['48'])[0])))
    index = (dt.date.fromisoformat(date) - START).days if date else None
    records = [dict(r) for r in db.execute(
        'SELECT t.*,p.calls FROM trips t JOIN patterns p ON p.id=t.pattern WHERE t.line=? AND t.stage IN (' + ','.join('?' for _ in stages) + ') ORDER BY t.start,t.id', [key] + stages)]
    signatures = defaultdict(set)
    for r in records:
        r['calls'] = json.loads(r['calls'])
        r['signature'] = tuple((c[0], c[2], c[3]) for c in r['calls'])
        if r['jy']:
            signatures[r['signature']].add(r['jy'])
    journeys = {}
    for r in records:
        candidates = signatures[r['signature']]
        identity = r['jy'] or (next(iter(candidates)) if len(candidates) == 1 else ('physical', r['signature']))
        journey = journeys.setdefault(identity, {'jy': identity if isinstance(identity, str) else '', 'trips': [], 'start': r['start']})
        journey['trips'].append(r)
    visible = []
    for j in journeys.values():
        if direction and not any(t['direction'] == direction for t in j['trips']):
            continue
        if index is not None and not any(0 <= index < 364 and int(t['days'], 16) & (1 << (363-index)) for t in j['trips']):
            continue
        visible.append(j)
    visible.sort(key=lambda j: (j['start'] if j['start'] is not None else -1, j['jy']))
    total = len(visible)
    groups = {}
    load_profiles(db,[t for j in visible[offset:offset+limit] for t in j['trips']])
    for j in visible[offset:offset+limit]:
        by_stage = {s: [t for t in j['trips'] if t['stage'] == s] for s in stages}
        stops = []
        for s in stages:
            for t in by_stage[s]:
                stops = merge_stops(stops, [[c[0], c[1]] for c in t['calls']])
        values = [[] for _ in stops]
        masks = {}
        summaries = []
        for s in stages:
            trips = by_stage[s]
            active_trips = [t for t in trips if index is not None and 0 <= index < 364 and int(t['days'], 16) & (1 << (363-index))]
            display_ids = {t['id'] for t in (active_trips or trips)}
            mask = 0
            for t in trips:
                mask |= int(t['days'], 16)
                t.pop('signature', None)
                if t['id'] not in display_ids:
                    continue
                aligned = {}
                matcher = SequenceMatcher(None, [c[0] for c in stops], [c[0] for c in t['calls']], autojunk=False)
                for a, b, size in matcher.get_matching_blocks():
                    for n in range(size):
                        aligned[a+n] = t['calls'][b+n]
                for i in range(len(stops)):
                    # Unique values are retained; repeated calendar blocks are not duplicate columns.
                    c = aligned.get(i)
                    value = [s, c[2], c[3], c[4], c[1]] if c else [s, None, None, '', None]
                    if value not in values[i]:
                        values[i].append(value)
            masks[s] = mask
            summaries.append({'stage': s, 'blocks': len(trips), 'days': format(mask, '091x'), 'dayCount': mask.bit_count(), 'active': bool(index is None or (0 <= index < 364 and mask & (1 << (363-index))))})
        differences = []
        missing = [s for s in stages if not by_stage[s]]
        if missing:
            differences.append({'kind': 'presence', 'stages': missing})
        present_masks = [masks[s] for s in stages if by_stage[s]]
        if len(set(present_masks)) > 1:
            differences.append({'kind': 'calendar'})
        attributes = {s: sorted(set((t['nr'], t['go'], t['direction'], t['notes']) for t in by_stage[s]), key=repr) for s in stages if by_stage[s]}
        if len({repr(v) for v in attributes.values()}) > 1:
            differences.append({'kind': 'source_metadata'})
        cells = []
        for i, vals in enumerate(values):
            for s in missing:
                vals.append([s, None, None, '', None])
            signatures_by_stage = {s: sorted(set((v[1], v[2], v[4]) for v in vals if v[0] == s), key=repr) for s in stages}
            changed = len({repr(v) for v in signatures_by_stage.values()}) > 1
            # Platform absence in HRDF is an extraction limitation, not evidence of loss.
            cells.append({'values': vals, 'changed': changed})
        if any(c['changed'] for c in cells):
            differences.append({'kind': 'calls'})
        features=compare_fields(j['trips'],stages,index)
        differences.extend({'kind':'feature','field':f['field'],'label':f['label']} for f in features if f['status']=='different')
        j.update({'stops': stops, 'cells': cells, 'sources': summaries, 'differences': differences,'featureComparison':features})
        for t in j['trips']:
            t['dayCount'] = int(t['days'], 16).bit_count()
            t.pop('features',None)
        routekey = json.dumps([c[0] for c in stops], ensure_ascii=False)
        group = groups.setdefault(routekey, {'stops': stops, 'journeys': []})
        group['journeys'].append(j)
    return {'total': total, 'blocks': len(records), 'offset': offset, 'limit': limit, 'groups': list(groups.values()), 'date': date, 'stages': stages}
