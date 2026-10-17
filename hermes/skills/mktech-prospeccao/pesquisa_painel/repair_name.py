import json,unicodedata
from research import ROOT,crm,dump,event
slug='katrina.valentim';path=ROOT/(slug+'.candidate.json')
c=json.loads(path.read_text(encoding='utf-8'))
c['business_name']=unicodedata.normalize('NFKC',c['business_name'])
c['pending_items']+='\nNome normalizado de caracteres tipográficos em negrito para letras comuns (Unicode NFKC), preservando a grafia publicada.'
dump(path,c)
code,r=crm('check','--file',str(path));dump(ROOT/(slug+'.check.json'),r)
if code:raise RuntimeError(str(r))
code,r=crm('register','--run','a530496c-7627-4e51-a4dc-1a1c2cef6956','--file',str(path));dump(ROOT/(slug+'.register.json'),r)
if code:raise RuntimeError(str(r))
event({'type':'registered','url':'https://euterapeuta.com.br/'+slug,'name':c['business_name'],'city':c['city'],'score':c['diagnosis']['fit_score'],'result':r})
event({'type':'error_resolved','url':'https://euterapeuta.com.br/'+slug,'reason':'Nome tipográfico normalizado por equivalência NFKC; cadastro aceito.'})
print(json.dumps(r,ensure_ascii=False))
