import json,sys,subprocess,pathlib
root=pathlib.Path(__file__).parent
crm=r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
run='adaabe7f-684a-43c9-aabe-a9b92dd5c73f'
data=json.load(sys.stdin)
for i,c in enumerate(data):
 p=root/('painel-'+c['business_name'].encode().hex()[:80]+'.json')
 p.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
 for action in ['check','register']:
  args=[sys.executable,crm,action,'--file',str(p)]
  if action=='register': args+=['--run',run]
  r=subprocess.run(args,capture_output=True)
  s=r.stdout.decode('utf-8','replace'); print(c['business_name']+': '+action+' '+s,flush=True)
  with (root/'painel-run-log.jsonl').open('a',encoding='utf-8') as f: f.write(json.dumps({'name':c['business_name'],'action':action,'code':r.returncode,'response':s})+'\n')
  if r.returncode: sys.exit(r.returncode)
  if action=='check' and json.loads(s).get('status')=='existente': break

