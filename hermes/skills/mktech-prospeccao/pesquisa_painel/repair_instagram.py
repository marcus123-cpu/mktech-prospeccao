import json
from research import ROOT,crm,dump,event
slug='marcus.teles';path=ROOT/(slug+'.candidate.json')
c=json.loads(path.read_text(encoding='utf-8'))
c['instagram']='massoterapeuta.marcusteless'
c['pending_items']+='\nO link público do Instagram termina em /profilecard; foi normalizado para o identificador massoterapeuta.marcusteless. Confirmar abertura do perfil e bio.'
dump(path,c)
code,r=crm('check','--file',str(path));dump(ROOT/(slug+'.check.json'),r)
if code:raise RuntimeError(str(r))
code,r=crm('register','--run','a530496c-7627-4e51-a4dc-1a1c2cef6956','--file',str(path));dump(ROOT/(slug+'.register.json'),r)
if code:raise RuntimeError(str(r))
event({'type':'registered','url':'https://euterapeuta.com.br/'+slug,'name':c['business_name'],'city':c['city'],'score':c['diagnosis']['fit_score'],'result':r})
event({'type':'error_resolved','url':'https://euterapeuta.com.br/'+slug,'reason':'URL profilecard normalizada para handle publicado; cadastro aceito.'})
print(json.dumps(r,ensure_ascii=False))
