import json, pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).parent
INST=pathlib.Path(r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts')
def inspect(key,name,city,ig='',phone='',services=1,fb=''):
    args=[sys.executable,'-X','utf8',str(INST/'inspecionar_presenca.py'),'--nome',name,'--cidade',city,'--instagram',ig,'--telefone',phone,'--servicos',str(services)]
    if fb: args+=['--facebook',fb]
    p=subprocess.run(args,capture_output=True,encoding='utf-8')
    (ROOT/(key+'-inspecao.json')).write_text(p.stdout,encoding='utf-8')
    print(key,p.returncode,p.stdout, p.stderr,flush=True)
def register(key,name,city,niche,ig,phone,services,evidences,address=None,inspection=None,pending=''):
    r=inspection or json.loads((ROOT/(key+'-inspecao.json')).read_text(encoding='utf-8'))
    ev=r['evidencias']+evidences
    social=any(r.get(k,{}).get('status')=='ok' for k in ('instagram','facebook'))
    if not social:
        r['site_status_sugerido']='verificacao_pendente'
        pending+=' Redes sociais oficiais e atividade atual não confirmadas; candidato incompleto para enriquecimento, sem qualificação de envio.'
        for e in r['evidencias']:
            e['limitation']='Não havia identificador de rede social confirmado para abertura. Busca negativa não comprova ausência de site, nem atividade atual.'
    for e in ev:
        if e.get('kind')=='busca' and 'nenhum site' in e.get('summary',''):
            e.setdefault('limitation','Busca e bio consultadas não excluem página própria não indexada; ausência não afirmada de forma absoluta.')
    score=r['nota_sugerida']
    pain=r['evidencias'][-1]['summary']
    obj=dict(business_name=name,city=city,state='SP',niche=niche,instagram=ig or None,phone=phone or None,services=services,address=address,source_name='busca_web',research_date='2026-10-17',website_url=None,whatsapp_url=None,selection_reason='Negócio do nicho e cidade configurados; presença inspecionada com Playwright. Nenhum site próprio localizado nas fontes consultadas; confirmar eventual página não indexada.',pending_items='Confirmar WhatsApp comercial e vínculo do número; confirmar data da última atividade e eventual site não indexado. '+pending,priority='alta' if score>=70 else 'media' if score>=40 else 'baixa',site_status=r['site_status_sugerido'],evidences=ev,diagnosis=dict(fit_score=score,confidence='media' if len(evidences)>0 else 'baixa',summary=f'{name} atua em {city}, no segmento {niche}. As fontes consultadas apresentam os serviços e canais públicos; a existência de site não indexado permanece sujeita a confirmação.',audience=f'Pessoas que procuram {services[0]} em {city}.',digital_presence=json.dumps(r.get('instagram',{}),ensure_ascii=False)+'; '+r['site']['situacao'],pains=[dict(pain='Hipótese a confirmar: uma página própria pode reunir apresentação dos serviços e contato fora das redes e diretórios.',evidence=pain)],opportunities=['Reunir serviços, apresentação e contato comercial em página própria, caso a lacuna seja confirmada.'],offer='site_institucional' if niche=='Academia' else 'landing_page',offer_reason='Apresentar serviços e canais em endereço próprio, sujeito à confirmação da presença digital.',approach='Pesquisa registrada para avaliação do motor V6; sem mensagem comercial preparada.',objections=[]))
    if not social: obj['diagnosis']['confidence']='baixa'
    path=ROOT/(key+'-candidato.json'); path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
    for cmd in [['check','--file',str(path)],['register','--run','b73b3f5c-d8df-4d64-944e-5bbd806e1c42','--file',str(path)]]:
        p=subprocess.run([sys.executable,'-X','utf8',str(INST/'mktech_crm.py')]+cmd,capture_output=True,encoding='utf-8')
        print(key,cmd[0],p.returncode,p.stdout,p.stderr,flush=True)
        (ROOT/(key+'-'+cmd[0]+'.json')).write_text(p.stdout,encoding='utf-8')
        if p.returncode or (cmd[0]=='check' and json.loads(p.stdout).get('status')=='existente'): break
if __name__=='__main__': inspect(*sys.argv[1:])
