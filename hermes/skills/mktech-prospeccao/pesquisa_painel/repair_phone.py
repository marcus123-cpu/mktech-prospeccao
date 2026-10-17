import json
from research import ROOT,crm,dump,event
slug='agnes.giuliani.brito.santiago'
path=ROOT/(slug+'.candidate.json')
c=json.loads(path.read_text(encoding='utf-8'))
c['phone']=None
c['pending_items']+='\nA fonte exibe (00) 00000-0000, um marcador inválido. Telefone removido; localizar contato comercial válido. Nota original do inspetor preservada, mas o componente de contato precisa de revisão.'
for e in c['evidences']:
    if '(00) 00000-0000' in e.get('summary',''):
        e['limitation']=e.get('limitation','')+' O número exibido é marcador inválido e não foi usado como contato.'
dump(path,c)
code,r=crm('check','--file',str(path));dump(ROOT/(slug+'.check.json'),r)
if code:raise RuntimeError(str(r))
code,r=crm('register','--run','a530496c-7627-4e51-a4dc-1a1c2cef6956','--file',str(path));dump(ROOT/(slug+'.register.json'),r)
if code:raise RuntimeError(str(r))
event({'type':'registered','url':'https://euterapeuta.com.br/'+slug,'name':c['business_name'],'city':c['city'],'score':c['diagnosis']['fit_score'],'result':r})
event({'type':'error_resolved','url':'https://euterapeuta.com.br/'+slug,'reason':'Telefone marcador removido, cadastro incompleto aceito.'})
print(json.dumps(r,ensure_ascii=False))
