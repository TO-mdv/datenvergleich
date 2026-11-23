import datetime as dt,json,math,sqlite3
from comparison import compare
from line_catalog import catalogue
STAGES=['dino','nered_v2','info','gesamt'];START=dt.date(2026,12,13)
mapdb=None
linedb=None
route=''
def connection():return linedb if route=='/api/compare' else mapdb
def selected(q):return [s for s in STAGES if s in q.get('stages',[','.join(STAGES)])[0].split(',')]
def marks(values):return ','.join('?' for _ in values)
def bounds(q):
 try:
  b=[float(x) for x in q.get('bbox',['7,47,9,48'])[0].split(',')]
  if len(b)!=4 or not all(math.isfinite(v) for v in b):raise ValueError()
  return b
 except ValueError:return [7,47,9,48]
def api(path,q):
 with connection() as db:
  if path=='/api/meta':
   stages=sorted([dict(r) for r in db.execute('SELECT * FROM stages') if r['id'] in STAGES],key=lambda r:STAGES.index(r['id']))
   for s in stages:
    s['lines']=db.execute('SELECT count(*) FROM stage_lines WHERE stage=?',(s['id'],)).fetchone()[0]
    s['stops']=db.execute('SELECT count(*) FROM stops WHERE stage=?',(s['id'],)).fetchone()[0]
    s['platforms']=db.execute('SELECT count(*) FROM platforms WHERE stage=?',(s['id'],)).fetchone()[0]
   return {'app':'zvv-timetable-compare','stages':stages,'start':'2026-12-13','end':'2027-12-11','defaultDate':'2026-12-14','local':True,'note':'Gesamt 30.10. ist ein älterer Vergleichsstand. Fachlicher DINO-/NeRED-Stand offen. METABHF und UMSTEIGB sind nicht Gegenstand dieser Ansicht.'}
  ss=selected(q)
  if not ss:return {'lines':[],'geoms':[],'stops':[],'platforms':[],'groups':[],'total':0}
  if path=='/api/compare':return compare(db,q,ss)
  if path=='/api/lines':
   return catalogue(db,q,ss)
  if path=='/api/map':
   west,south,east,north=bounds(q);zoom=int(q.get('zoom',['12'])[0]);line=q.get('line',[''])[0];only=q.get('only',['0'])[0]=='1';gs=list(ss)
   geo=[];truncated=False;quota=max(450,1800//len(gs))
   for current in gs:
    cond='';params=[current,north,south,east,west]
    if only and line:cond=' AND g.line=?';params.append(line)
    sql='SELECT g.*,l.label,l.dino,l.nered FROM geoms g JOIN lines l ON l.key=g.line WHERE g.stage=? AND g.minlat<=? AND g.maxlat>=? AND g.minlon<=? AND g.maxlon>=?'+cond+' ORDER BY CASE WHEN g.line=? THEN 0 ELSE 1 END LIMIT ?';params.extend([line,quota+1])
    values=[dict(r) for r in db.execute(sql,params)];truncated=truncated or len(values)>quota;geo.extend(values[:quota])
   for r in geo:
    points=json.loads(r.pop('path'));maxpoints=1800 if r['line']==line else 350
    step=max(1,math.ceil(len(points)/maxpoints));r['path']=points[::step]
    if points and r['path'][-1]!=points[-1]:r['path'].append(points[-1])
   out={'geoms':geo,'stops':[],'platforms':[],'selectedStops':[],'truncatedLines':truncated,'zoom':zoom}
   if line:
    wanted={s:set() for s in ss}
    for record in db.execute(f'SELECT DISTINCT p.stage,p.calls FROM patterns p JOIN (SELECT DISTINCT pattern FROM trips WHERE line=? AND stage IN ({marks(ss)})) t ON t.pattern=p.id',[line]+ss):
     for call in json.loads(record['calls']):wanted[record['stage']].add(call[5])
    for source,stop_ids in wanted.items():
     if stop_ids:
      out['selectedStops'].extend(dict(r,selected=True) for r in db.execute(f'SELECT * FROM stops WHERE stage=? AND id IN ({marks(stop_ids)})',[source]+sorted(stop_ids)))
   for table,flag,cap in [('stops','stops',3500),('platforms','platforms',4500)]:
    if q.get(flag,['1'])[0]!='1' or (table=='platforms' and zoom<15):continue
    if table=='platforms':
     sql=f'SELECT p.*,s.name AS stop_name FROM platforms p LEFT JOIN stops s ON s.stage=p.stage AND s.id=p.stop WHERE p.stage IN ({marks(ss)}) AND p.lat>=? AND p.lat<=? AND p.lon>=? AND p.lon<=? ORDER BY p.uses DESC LIMIT ?'
    else:sql=f'SELECT * FROM {table} WHERE stage IN ({marks(ss)}) AND lat>=? AND lat<=? AND lon>=? AND lon<=? ORDER BY uses DESC LIMIT ?'
    values=[dict(r) for r in db.execute(sql,ss+[south,north,west,east,cap+1])]
    out[flag]=values[:cap];out['truncated_'+flag]=len(values)>cap
   return out
  if path=='/api/line':
   key=q.get('key',[''])[0];line=db.execute('SELECT * FROM lines WHERE key=?',(key,)).fetchone()
   if not line:return {'error':'Linie nicht gefunden'}
   result=dict(line);result['stages']=[dict(r) for r in db.execute('SELECT * FROM stage_lines WHERE key=?',(key,)) if r['stage'] in STAGES]
   boxes=[list(r) for r in db.execute(f'SELECT min(minlat),max(maxlat),min(minlon),max(maxlon) FROM geoms WHERE line=? AND stage IN ({marks(ss)})',[key]+ss)]
   result['bounds']=boxes[0] if boxes and boxes[0][0] is not None else None;return result
  if path=='/api/timetable':
   key=q.get('key',[''])[0];date=q.get('date',['2026-12-14'])[0];direction=q.get('direction',[''])[0];offset=max(0,int(q.get('offset',['0'])[0]));limit=min(120,max(1,int(q.get('limit',['48'])[0])))
   params=[key]+ss;where=f't.line=? AND t.stage IN ({marks(ss)})'
   if date:
    try:index=(dt.date.fromisoformat(date)-START).days
    except ValueError:return {'error':'Ungültiger Betriebstag'}
    where+=' AND active(t.days,?)';params.append(index)
   if direction:where+=' AND t.direction=?';params.append(direction)
   count=db.execute('SELECT count(*) FROM trips t WHERE '+where,params).fetchone()[0]
   data=[dict(r) for r in db.execute('SELECT t.*,p.calls,p.pathkey FROM trips t JOIN patterns p ON p.id=t.pattern WHERE '+where+' ORDER BY t.start,t.stage,t.nr,t.id LIMIT ? OFFSET ?',params+[limit,offset])]
   groups={}
   for r in data:
    r['calls']=json.loads(r['calls']);r['dayCount']=int(r.pop('days'),16).bit_count();g=groups.setdefault(r['pathkey'],{'key':r['pathkey'],'stops':[[c[0],c[1]] for c in r['calls']],'trips':[]});g['trips'].append(r)
   return {'total':count,'offset':offset,'limit':limit,'groups':list(groups.values()),'date':date}
 return {'error':'Unbekannte Abfrage'}
