"""Check all compressed payloads and compare representative exports to source."""
import argparse,gzip,hashlib,json,sqlite3,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'docs/python'))
from comparison import compare

def verify(source):
    folder=ROOT/'docs/data';manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['stages']==['dino','nered_v2','info','gesamt']
    for item in [dict(manifest['map'],file='map.sqlite.gz'),*manifest['lines'].values()]:
        payload=(folder/item['file']).read_bytes()
        assert len(payload)==item['bytes'] and hashlib.sha256(payload).hexdigest()==item['sha256'],item['file']
    db=sqlite3.connect(source);db.row_factory=sqlite3.Row
    assert manifest['counts']=={s:db.execute('SELECT count(*) FROM trips WHERE stage=?',(s,)).fetchone()[0] for s in manifest['stages']}
    checks=0
    for key in ['70-12-D','79-8-N']:
        exported=sqlite3.connect(':memory:');exported.row_factory=sqlite3.Row
        exported.deserialize(gzip.decompress((folder/manifest['lines'][key]['file']).read_bytes()))
        assert not exported.execute("SELECT 1 FROM trips WHERE stage='nered'").fetchone()
        for stages in [manifest['stages'],['dino','nered_v2'],['nered_v2']]:
            for date in ['', '2026-12-19','2027-05-08']:
                query={'key':[key],'date':[date],'limit':['12']}
                expected=compare(db,query,stages);actual=compare(exported,query,stages)
                assert actual==expected,(key,stages,date)
                checks+=1
        exported.close()
    print(f'OK: {len(manifest["lines"])} Linien-Dateien, alle Prüfsummen, Quellzählungen und {checks} Vergleichsabfragen identisch.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);verify(p.parse_args().source)
