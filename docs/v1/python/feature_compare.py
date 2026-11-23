"""Read-only comparison of resolved timetable features, scopes and operating days."""
import collections as C
import json

FIELDS = {'direction':'Richtungstext (*R / RICHTUNG)', 'category':'Verkehrsmittel (*G / ZUGART)', 'line':'Linienkurz-/langname (*L / LINIE)', 'haltcode':'Haltecode / Bedienung', 'attributes':'Attribute (*A / ATTRIBUT)', 'notices':'Verkehrshinweise (*I hi)', 'other_info':'Weitere Infotexte (*I)', 'through':'Durchbindungen (DURCHBI)'}
ALL = (1 << 364)-1


def canon(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def load_profiles(db, trips):
    if not trips:
        return
    ids = [t['id'] for t in trips]
    values = {}
    byid = {t['id']:t for t in trips}
    for begin in range(0,len(ids),500):
        batch=ids[begin:begin+500]
        for r in db.execute('SELECT tf.trip_id,p.id,p.data FROM trip_features tf JOIN feature_profiles p ON p.id=tf.profile WHERE tf.trip_id IN ('+','.join('?' for _ in batch)+')',batch):
            if r['id'] not in values:values[r['id']]=json.loads(r['data'])
            byid[r['trip_id']]['features']=dict(values[r['id']],through=[])
        for column,partner,maskcol in [('from_trip','to_jy','from_days'),('to_trip','from_jy','to_days')]:
            for r in db.execute('SELECT * FROM through_edges WHERE '+column+' IN ('+','.join('?' for _ in batch)+')',batch):
                t=byid[r[column]];position=len(t['calls'])-1 if column=='from_trip' else 0
                t['features']['through'].append({'start':position,'end':position,'days':r[maskcol],'value':{'relation':'weiter nach' if column=='from_trip' else 'kommt von','partner':r[partner],'stop1':r['stop1'],'stop2':r['stop2'],'attribute':r['attribute']},'origin':'DURCHBI Zeilen '+r['sources']})
        for r in db.execute('SELECT * FROM through_issues WHERE trip_id IN ('+','.join('?' for _ in batch)+')',batch):
            t=byid[r['trip_id']]
            t['features']['unavailable']=list(t['features'].get('unavailable',[]))+['through']
            t['features']['issues']=list(t['features'].get('issues',[]))+json.loads(r['issues'])


def aggregate(trips, field, index=None, german_only=False):
    result={}
    for t in trips:
        p=t.get('features')
        if not p or field in p.get('unavailable',[]):
            return None
        calls=t['calls']
        counts=C.Counter()
        tokens=[]
        for c in calls:
            counts[c[0]]+=1
            tokens.append((c[0],counts[c[0]]))
        base=int(t['days'],16)
        for entry in p.get(field,[]):
            mask=base & (int(entry['days'],16) if entry.get('days') else ALL)
            if index is not None:
                mask &= 1 << (363-index) if 0<=index<364 else 0
            if not mask:
                continue
            start,end=entry.get('start',0),entry.get('end',len(calls)-1)
            if start is None or end is None:
                return None
            value=entry['value']
            if field=='direction':value={k:v for k,v in value.items() if k!='source'}
            if 'UNRESOLVED:' in canon(value) or '"unresolved"' in canon(value) or (field=='attributes' and value.get('definition') is None):return None
            if german_only:
                def de(v):
                    if isinstance(v,dict):
                        return {k:({lang:txt for lang,txt in x.items() if lang=='de'} if k in ['texts','names'] and isinstance(x,dict) else de(x)) for k,x in v.items()}
                    if isinstance(v,list):return [de(x) for x in v]
                    return v
                value=de(value)
            # Edges for line/category/destination; individual calls for stop rights/attributes.
            positions=range(start,max(start+1,end)) if field in ['category','line','direction'] else range(start,end+1)
            for i in positions:
                if not 0<=i<len(tokens):return None
                token=(tokens[i],tokens[i+1]) if field in ['category','line','direction'] and i+1<len(tokens) else (tokens[i],)
                key=canon([token,value])
                result[key]=result.get(key,0)|mask
    return result


def compare_fields(trips, stages, index=None):
    bystage={s:[t for t in trips if t['stage']==s] for s in stages}
    summaries=[]
    for field,label in FIELDS.items():
        values={s:aggregate(ts,field,index) for s,ts in bystage.items() if ts}
        known={s:v for s,v in values.items() if v is not None}
        pairs=[]
        present=[s for s in stages if bystage[s]]
        for i,a in enumerate(present):
            for b in present[i+1:]:
                ma=0;mb=0
                for t in bystage[a]:ma|=int(t['days'],16)
                for t in bystage[b]:mb|=int(t['days'],16)
                common=ma&mb
                if index is not None:common&=1<<(363-index) if 0<=index<364 else 0
                va=aggregate(bystage[a],field,index,german_only='dino' in [a,b]);vb=aggregate(bystage[b],field,index,german_only='dino' in [a,b])
                if not common or va is None or vb is None:status='unknown'
                else:status='equal' if {k:v&common for k,v in va.items() if v&common}=={k:v&common for k,v in vb.items() if v&common} else 'different'
                pairs.append({'from':a,'to':b,'status':status,'days':common.bit_count()})
        status='different' if any(p['status']=='different' for p in pairs) else 'unknown' if not pairs or any(p['status']=='unknown' for p in pairs) else 'equal'
        sources=[]
        for stage in stages:
            ts=bystage[stage]
            entries=[]
            seen=set()
            for t in ts:
                p=t.get('features',{})
                for entry in p.get(field,[]):
                    value=dict(entry)
                    value['tripSource']=t['source']
                    value['days']=format(int(t['days'],16)&(int(entry['days'],16) if entry.get('days') else ALL),'091x')
                    key=canon(value)
                    if key not in seen:entries.append(value);seen.add(key)
            sources.append({'stage':stage,'known':stage in known,'present':bool(ts),'entries':entries,'issues':sorted({issue for t in ts for issue in t.get('features',{}).get('issues',[])})})
        summaries.append({'field':field,'label':label,'status':status,'sources':sources,'pairs':pairs})
    return summaries
