import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).parent
CLIENT = r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
RUN = 'c1c16c21-7f67-49d1-8d9d-c6fd44a1b67c'

def candidate(name, city, state, phone, slug, services, detail, activity_url, activity, extra=None):
    evidence = [{'kind':'diretorio','url':'https://euterapeuta.com.br/'+slug,'summary':f'{name}, {city} - {state}. Telefone comercial público: {phone}. Serviços: {", ".join(services)}. {detail}','observed_at':'2026-10-15'}]
    evidence.append({'kind':'diretorio','url':activity_url,'summary':activity,'observed_at':'2026-10-15','limitation':'Sinal de acesso ao perfil no diretório; não comprova sessão ou publicação recente.'})
    if extra: evidence.append(extra)
    return {'business_name':name,'city':city,'state':state,'phone':phone,'niche':'Massoterapeutas','services':services,'source_name':'euterapeuta','source_place_id':'euterapeuta:'+slug,'research_date':'2026-10-15','website_url':None,'whatsapp_url':None,'site_status':'verificacao_pendente','priority':'baixa','selection_reason':'Serviços de massoterapia e canal comercial públicos na cidade configurada. Candidato incompleto para enriquecimento: site próprio não identificado nas fontes consultadas, sem afirmar sua ausência.','pending_items':'Confirmar presença digital completa, domínio próprio e links de redes sociais; validar WhatsApp do número público sem contato; confirmar atividade comercial recente e endereço de atendimento. Não tratar acesso ao diretório como prova de atendimento.','evidences':evidence,'diagnosis':{'fit_score':35,'confidence':'baixa','summary':f'{name} divulga {services[0]} em {city}. O perfil oferece informações de atendimento; a presença digital e a atividade comercial atual exigem confirmação.','audience':f'Pessoas que procuram {services[0]} em {city}; hipótese baseada no serviço anunciado.','digital_presence':activity+' Site próprio não confirmado; ausência não estabelecida.','pains':[{'pain':'Hipótese a confirmar: uma página própria pode reunir apresentação dos serviços e informações de contato, caso ainda não exista.','evidence':evidence[0]['summary']}],'opportunities':['Se a ausência de página própria for confirmada, avaliar uma landing page de serviços, formação e contato.'],'offer':'landing_page','offer_reason':'Possibilidade preliminar condicionada à confirmação de ausência de página própria; não há evidência para recomendar automação de agenda.','objections':[]}}

def save_check_register(c):
    path = ROOT / ('candidate_'+c['source_place_id'].split(':')[-1]+'.json')
    path.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
    for command in (['check','--file',str(path)], ['register','--run',RUN,'--file',str(path)]):
        p = subprocess.run([sys.executable,CLIENT]+command,capture_output=True,text=True,encoding='utf-8',errors='replace')
        print(c['business_name'],command[0],p.returncode,p.stdout.strip(),flush=True)
        with (ROOT/'research_results.jsonl').open('a',encoding='utf-8') as f:
            f.write(json.dumps({'name':c['business_name'],'command':command[0],'exit':p.returncode,'output':p.stdout},ensure_ascii=False)+'\n')
        if p.returncode != 0: return
        response=json.loads(p.stdout)
        if command[0]=='check' and response.get('status')=='existente': return

if __name__=='__main__':
    for c in json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')):
        save_check_register(c)
