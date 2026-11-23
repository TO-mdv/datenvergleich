"""Export the viewer database as public, static, per-line browser datasets.

Usage: python tools/export_data.py --source <timetables.sqlite> --output docs/data
Only the four visible stages are exported; source files are never modified.
"""
import argparse
import gzip
import hashlib
import json
import sqlite3
import time
from pathlib import Path

STAGES=('dino','nered_v2','info','gesamt')
FILTER="stage IN ('dino','nered_v2','info','gesamt')"

def package(db,target):
    payload=db.serialize()
    compressed=gzip.compress(payload,compresslevel=6,mtime=0)
    target.write_bytes(compressed)
    return {'bytes':len(compressed),'expandedBytes':len(payload),'sha256':hashlib.sha256(compressed).hexdigest()}

def attached(source):
    db=sqlite3.connect(':memory:',uri=True)
    db.execute('ATTACH DATABASE ? AS source',(source,))
    return db

def export(source,output):
    output.mkdir(parents=True,exist_ok=True);(output/'lines').mkdir(exist_ok=True)
    original=sqlite3.connect(source,uri=True)
    original.row_factory=sqlite3.Row
    db=attached(source)
    for table in ['stages','stops','platforms','stage_lines','geoms']:
        field='id' if table=='stages' else 'stage'
        condition=FILTER.replace('stage',field)
        db.execute(f'CREATE TABLE {table} AS SELECT * FROM source.{table} WHERE {condition}')
    db.execute('CREATE TABLE lines AS SELECT * FROM source.lines WHERE key IN (SELECT key FROM stage_lines)')
    for sql in ['CREATE INDEX geo_bounds ON geoms(stage,minlat,maxlat,minlon,maxlon)',
                'CREATE INDEX geo_line ON geoms(line,stage)',
                'CREATE INDEX stop_bounds ON stops(stage,lat,lon)',
                'CREATE INDEX stop_id ON stops(stage,id)',
                'CREATE INDEX platform_bounds ON platforms(stage,lat,lon)',
                'CREATE INDEX source_line ON stage_lines(key,stage)',
                'CREATE INDEX line_id ON lines(key)']:db.execute(sql)
    db.commit()
    manifest={'version':1,'stages':list(STAGES),'period':['2026-12-13','2027-12-11'],
              'map':package(db,output/'map.sqlite.gz'),'lines':{},'counts':{}}
    db.close()
    keys=[r[0] for r in original.execute(f'SELECT DISTINCT line FROM trips WHERE {FILTER} ORDER BY line')]
    started=time.monotonic()
    for i,key in enumerate(keys):
        name=hashlib.sha256(key.encode()).hexdigest()[:20]+'.sqlite.gz'
        target=output/'lines'/name
        db=attached(source)
        db.execute(f'CREATE TABLE trips AS SELECT * FROM source.trips WHERE line=? AND {FILTER}',(key,))
        db.execute('CREATE INDEX trips_id ON trips(id)')
        db.execute('CREATE INDEX trips_pattern ON trips(pattern)')
        db.execute('CREATE TABLE patterns AS SELECT * FROM source.patterns WHERE id IN (SELECT pattern FROM trips)')
        db.execute('CREATE INDEX patterns_id ON patterns(id)')
        db.execute('CREATE TABLE trip_features AS SELECT * FROM source.trip_features WHERE trip_id IN (SELECT id FROM trips)')
        db.execute('CREATE INDEX tf_trip ON trip_features(trip_id)')
        db.execute('CREATE TABLE feature_profiles AS SELECT * FROM source.feature_profiles WHERE id IN (SELECT profile FROM trip_features)')
        db.execute('CREATE INDEX profile_id ON feature_profiles(id)')
        db.execute('CREATE TABLE through_edges AS SELECT * FROM source.through_edges WHERE from_trip IN (SELECT id FROM trips) OR to_trip IN (SELECT id FROM trips)')
        db.execute('CREATE INDEX through_from ON through_edges(from_trip)')
        db.execute('CREATE INDEX through_to ON through_edges(to_trip)')
        db.execute('CREATE TABLE through_issues AS SELECT * FROM source.through_issues WHERE trip_id IN (SELECT id FROM trips)')
        db.execute('CREATE INDEX ti_trip ON through_issues(trip_id)')
        db.commit()
        item=package(db,target);item['file']='lines/'+name
        item['trips']=db.execute('SELECT count(*) FROM trips').fetchone()[0]
        manifest['lines'][key]=item
        db.close()
        if i%100==0:print(f'{i+1}/{len(keys)} lines, {time.monotonic()-started:.1f}s',flush=True)
    for stage in STAGES:
        manifest['counts'][stage]=original.execute('SELECT count(*) FROM trips WHERE stage=?',(stage,)).fetchone()[0]
    manifest['totalBytes']=manifest['map']['bytes']+sum(v['bytes'] for v in manifest['lines'].values())
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'lines':len(keys),'totalMB':round(manifest['totalBytes']/1e6,2),'counts':manifest['counts']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    export(a.source.resolve().as_uri()+'?mode=ro',a.output)
