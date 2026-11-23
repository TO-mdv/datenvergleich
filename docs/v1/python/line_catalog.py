"""Small line catalogue; compare source block counts without conflating national scope."""
STAGES = ['dino', 'nered_v2', 'info', 'gesamt']


def catalogue(db, q, enabled):
    focus = q.get('comparison', ['chain'])[0]
    reference = 'nered_v2'
    pairs = [('dino','nered_v2')] if focus == 'dino_v2' else [('dino','nered_v2'),(reference,'info'),(reference,'gesamt')]
    rows = {r['key']: dict(r, counts={}, source_lines={}) for r in db.execute('SELECT * FROM lines ORDER BY nered,dino,label')}
    for r in db.execute('SELECT * FROM stage_lines'):
        if r['stage'] not in STAGES:
            continue
        line = rows[r['key']]
        line['counts'][r['stage']] = r['total']
        diva = line['dino'] if r['stage'] == 'dino' else (line['nered'] or line['dino'])
        line['source_lines'][r['stage']] = {'label': r['label'], 'diva': diva, 'gos': r['gos'], 'assigned': r['stage'] in ('info', 'gesamt') and bool(diva)}
    text = q.get('q', [''])[0].strip().casefold()
    mode = q.get('difference', ['all'])[0]
    sort = q.get('sort', ['line'])[0]
    result = []
    for line in rows.values():
        if not any(line['counts'].get(s, 0) for s in enabled):
            continue
        if text and text not in ' '.join(str(v or '') for v in [line['key'], line['dino'], line['nered'], line['label']] + [v for s in line['source_lines'].values() for v in s.values()]).casefold():
            continue
        comparisons = []
        # Purely national lines without DIVA lineage do not indicate a missing ZVV delivery.
        if line['dino'] or line['nered']:
            for before, after in pairs:
                if before not in enabled or after not in enabled:
                    continue
                a, b = line['counts'].get(before, 0), line['counts'].get(after, 0)
                if not a and not b:
                    continue
                delta = b-a
                comparisons.append({'before': before, 'after': after, 'delta': delta, 'percent': 100*delta/a if a else None, 'missing': not a or not b})
        line['comparisons'] = comparisons
        line['max_delta'] = max((abs(c['delta']) for c in comparisons), default=0)
        line['max_percent'] = max((abs(c['percent']) if c['percent'] is not None else 100 for c in comparisons), default=0)
        line['missing'] = any(c['missing'] for c in comparisons)
        changed = any(c['delta'] for c in comparisons)
        if mode == 'changed' and not changed:
            continue
        if mode == 'large' and not any(abs(c['delta']) >= 50 and (c['percent'] is None or abs(c['percent']) >= 25) for c in comparisons):
            continue
        if mode == 'missing' and not line['missing']:
            continue
        if mode == 'half' and not any(c['percent'] is None or abs(c['percent']) >= 50 for c in comparisons):
            continue
        result.append(line)
    if sort == 'absolute':
        result.sort(key=lambda r: (-r['max_delta'], -r['max_percent'], r['key']))
    elif sort == 'percent':
        result.sort(key=lambda r: (-r['max_percent'], -r['max_delta'], r['key']))
    else:
        result.sort(key=lambda r: (r['key'].startswith('HRDF:'), r['nered'] or '', r['dino'] or '', r['label'] or ''))
    limit = min(5000, max(1, int(q.get('limit', ['500'])[0])))
    return {'lines': result[:limit], 'total': len(result), 'difference': mode, 'sort': sort}
