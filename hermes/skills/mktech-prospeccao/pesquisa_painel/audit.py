import json
from research import ROOT
events=[json.loads(l) for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines()]
rows=[e for e in events if e['type']=='registered']
issues=[]
ids=[]
for e in rows:
    slug=e['url'].rstrip('/').split('/')[-1]
    cp=ROOT/(slug+'.candidate.json');ip=ROOT/(slug+'.inspection.json')
    if not cp.exists() or not ip.exists():issues.append({'slug':slug,'error':'Arquivo de candidato/inspeção ausente'});continue
    c=json.loads(cp.read_text(encoding='utf-8'));i=json.loads(ip.read_text(encoding='utf-8'))
    if c['diagnosis']['fit_score']!=i['nota_sugerida']:issues.append({'slug':slug,'error':'Nota diverge do inspetor'})
    if not c.get('pending_items') or not c.get('evidences'):issues.append({'slug':slug,'error':'Pendência/evidência ausente'})
    if c.get('niche')!='Massagem':issues.append({'slug':slug,'error':'Nicho divergente'})
    if e['result'].get('status')=='criado':ids.append(e['result']['lead_id'])
    if any(k in c for k in ('mensagem','message','stage','status','approach')):issues.append({'slug':slug,'error':'Campo comercial indevido'})
if len(ids)!=len(set(ids)):issues.append({'error':'ID de novo lead repetido'})
out={'checked_registrations':len(rows),'unique_new_leads':len(set(ids)),'issues':issues}
(ROOT/'audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False))
if issues:raise SystemExit(2)
