import sys, os, json, re, time, subprocess, unicodedata
from pathlib import Path
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent
CRM=Path(r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py')
INSPECT=CRM.with_name('inspecionar_presenca.py')
RUN='a530496c-7627-4e51-a4dc-1a1c2cef6956'
ENV={**os.environ,'PYTHONIOENCODING':'utf-8','PYTHONUTF8':'1'}
def dump(path,data): path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
def event(data):
    with (ROOT/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(data,ensure_ascii=False)+'\n')
def crm(*args):
    p=subprocess.run([sys.executable,'-X','utf8',str(CRM),*args],capture_output=True,text=True,encoding='utf-8',env=ENV)
    try:r=json.loads(p.stdout)
    except Exception:r={'parse_error':p.stdout[:1000],'stderr':p.stderr[:1000]}
    return p.returncode,r
def norm(t):return ''.join(c for c in unicodedata.normalize('NFKD',t.lower()) if not unicodedata.combining(c))
def searches():return 10+sum(1 for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines() if json.loads(l).get('type')=='search') if (ROOT/'events.jsonl').exists() else 10
def fetch(url):
    r=requests.get(url,timeout=45);r.raise_for_status()
    return BeautifulSoup(r.content,'html.parser')
CITIES=[('Manaus','AM'),('João Pessoa','PB'),('Campo Grande','MS'),('Recife','PE'),('Porto Alegre','RS'),('Vitória','ES'),('São Luís','MA'),('Brasília','DF'),('Joinville','SC'),('Uberlândia','MG'),('Santos','SP'),('Fortaleza','CE'),('Natal','RN'),('Salvador','BA'),('Goiânia','GO'),('Belém','PA'),('Curitiba','PR'),('Maceió','AL'),('Aracaju','SE'),('Teresina','PI')]
def discover():
    code,ids=crm('identifiers')
    if code:raise RuntimeError(str(ids))
    dump(ROOT/'identifiers.json',ids)
    known=ids.get('identifiers',{})
    knownsources=set(known.get('source_ids',[]))
    knownnames={(norm(n['name']),norm(n['city'])) for n in known.get('names',[])}
    queue=[];seen=set()
    for city,state in CITIES:
        slug=re.sub(r'[^a-z0-9]+','-',norm(city)).strip('-')+'-'+state.lower()
        url='https://euterapeuta.com.br/terapeutas/massagem-relaxante/'+slug
        event({'type':'search','url':url,'purpose':'descoberta e atividade'})
        soup=fetch(url)
        (ROOT/(slug+'.html')).write_text(str(soup),encoding='utf-8')
        for a in soup.select('a[href]'):
            text=a.get_text(' ',strip=True);href=a['href']
            if 'Visto há' not in text or href in seen:continue
            seen.add(href)
            recent=re.search(r'Visto há (\d+) (dia|semana|mês|meses|hora|minuto)',text)
            if not recent or ('m' in recent.group(2) and recent.group(2) in ('mês','meses') and int(recent.group(1))>6):continue
            queue.append({'url':href,'city':city,'state':state,'listing_url':url,'listing_text':text})
        print(json.dumps({'city':city,'queue':len(queue),'searches':searches()},ensure_ascii=False),flush=True)
    dump(ROOT/'queue.json',queue)

def process(count):
    queue=json.loads((ROOT/'queue.json').read_text(encoding='utf-8'))
    ids=json.loads((ROOT/'identifiers.json').read_text(encoding='utf-8'))['identifiers']
    knownsources=set(ids.get('source_ids',[])); knownnames={(norm(n['name']),norm(n['city'])) for n in ids.get('names',[])}
    completed=set()
    if (ROOT/'events.jsonl').exists():
        for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines():
            e=json.loads(l)
            if e.get('type') in ('registered','discard','review','candidate_error'):completed.add(e.get('url'))
    processed=0
    # Round-robin cities rather than consuming a single city first.
    groups=[[q for q in queue if q['city']==city] for city,state in CITIES]
    ordered=[g[i] for i in range(max(map(len,groups))) for g in groups if i<len(g)]
    for q in ordered:
        if (ROOT/'stop').exists():break
        if q['url'] in completed:continue
        if processed>=count or searches()+2>1500:break
        events=[json.loads(l) for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines()]
        if sum(e.get('type')=='registered' and e.get('result',{}).get('status')=='criado' for e in events)>=100:break
        slug=q['url'].rstrip('/').split('/')[-1]; source='euterapeuta:'+slug
        if source in knownsources:
            event({'type':'discard','url':q['url'],'reason':'duplicado'});continue
        try:
            soup=fetch(q['url']); name=soup.select_one('h1').get_text(' ',strip=True)
            if (norm(name),norm(q['city'])) in knownnames:
                event({'type':'discard','url':q['url'],'reason':'duplicado'});continue
            # Profile, not directory footer, must confirm city and service.
            full=soup.get_text(' ',strip=True); head=full.split('Psicólogos Psicólogos Online')[0]
            if q['city']+' - '+q['state'] not in head:
                event({'type':'review','url':q['url'],'reason':'cidade divergente','name':name});continue
            services=list(dict.fromkeys(a.get_text(' ',strip=True) for a in soup.select('a[href]') if '/terapeutas/' in a['href'] and a.get_text(' ',strip=True)))
            services=[s for s in services if any(x in norm(s) for x in ['massagem','drenagem','miofascial','reflexologia','ventosa','shiatsu'])]
            if not services:
                event({'type':'discard','url':q['url'],'reason':'fora_do_nicho'});continue
            phone_el=soup.select_one('a[href^="tel:"]');phone=phone_el.get_text(' ',strip=True) if phone_el else None
            if phone and (len(re.sub(r'\D','',phone)) not in (10,11,12,13) or re.sub(r'\D','',phone).startswith('00')):phone=None
            # Only actual profile social links; footer belongs to the directory.
            links=[a['href'] for a in soup.select('a[href]')]
            external=[u for u in links if u.startswith('http') and not any(d in urlparse(u).netloc.lower() for d in ('euterapeuta.com.br','instagram.com','facebook.com','fb.com','youtube.com','youtu.be','wa.me','whatsapp.com','twitter.com','x.com','t.me','telegram.me'))]
            aggregators=[u for u in external if any(d in urlparse(u).netloc.lower() for d in ('linktr.ee','beacons.ai','bio.link','lnk.bio','campsite.bio'))]
            if [u for u in external if u not in aggregators]:
                event({'type':'review','url':q['url'],'name':name,'city':q['city'],'reason':'links_externos_no_perfil','links':list(dict.fromkeys(external))});processed+=1;continue
            ig=next((u for u in links if 'instagram.com/' in u and '_euterapeuta' not in u),'')
            fb=next((u for u in links if ('facebook.com/' in u or 'fb.com/' in u) and 'euterapeuta' not in u and 'sharer' not in u),'')
            ig_handle=ig.split('instagram.com/')[-1].split('?')[0].strip('/').split('/')[0] if ig else ''
            if ig_handle and not re.fullmatch(r'[A-Za-z0-9_.]{1,30}',ig_handle):ig_handle=''
            prefix=ROOT/(slug+'.profile.txt');prefix.write_text(head,encoding='utf-8')
            command=[sys.executable,'-X','utf8',str(ROOT/'inspect_runner.py'),str(ROOT/'events.jsonl'),str(INSPECT),'--nome',name,'--cidade',q['city'],'--servicos',str(len(services))]
            if phone:command+=['--telefone',phone]
            if ig_handle:command+=['--instagram',ig_handle]
            if fb:command+=['--facebook',fb]
            if aggregators:command+=['--site',aggregators[0]]
            print(json.dumps({'inspecting':name,'city':q['city'],'searches':searches()},ensure_ascii=False),flush=True)
            p=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',env=ENV,timeout=240)
            (ROOT/(slug+'.inspection.stdout')).write_text(p.stdout,encoding='utf-8')
            if p.returncode:
                event({'type':'inspection_error','url':q['url'],'error':p.stderr[-1200:]})
                p=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',env=ENV,timeout=240)
            if p.returncode:raise RuntimeError(p.stderr[-1200:])
            inspection=json.loads(p.stdout);dump(ROOT/(slug+'.inspection.json'),inspection)
            findings=inspection['site']['detalhe']
            if any(d['tipo'].startswith('site') for d in findings):
                event({'type':'review','url':q['url'],'name':name,'city':q['city'],'reason':'avaliar_site','findings':findings});processed+=1;continue
            ev=inspection['evidencias']
            # Inspector says it checked bio even when no social URL was available: retain
            # original evidence but explicitly state that limitation.
            for e in ev:
                if e['kind']=='busca':e['limitation']='Busca limitada aos resultados retornados pelo Bing; bio só foi verificável quando rede social abriu. Não prova inexistência de site.'
            summary=f"{name}; {q['city']} - {q['state']}; contato público: {phone or 'não informado'}; serviços: {', '.join(services)}."
            ev.append({'kind':'diretorio','url':q['url'],'summary':summary,'observed_at':'2026-10-16','limitation':'Perfil de marketplace; informações declaradas pelo anunciante, sem validação independente.'})
            ev.append({'kind':'diretorio','url':q['listing_url'],'summary':q['listing_text'],'observed_at':'2026-10-16','limitation':'Visto há indica acesso ao diretório, não prova atendimento nem data de publicação; mesma origem do perfil.'})
            pending=['Confirmar atividade de atendimento diretamente em fonte independente; o sinal de uso recente observado é do diretório.','Confirmar presença digital e eventual site/landing page com o negócio; busca negativa não prova ausência.','Obter segunda fonte independente.','Confirmar WhatsApp do telefone comercial, sem abrir ou contatar WhatsApp.']
            if not ig_handle:pending.append('Localizar Instagram e Facebook oficiais e conferir links da bio; perfil não forneceu identificadores verificáveis dessas redes.')
            if not phone:pending.append('Localizar telefone comercial público.')
            pending+=inspection['avisos']
            candidate={'business_name':name,'niche':'Massagem','city':q['city'],'state':q['state'],'services':services,'phone':phone,'instagram':ig_handle or None,'whatsapp_url':None,'website_url':None,'source_name':'euterapeuta','source_place_id':source,'research_date':'2026-10-16','selection_reason':'Perfil público de massagem com sinal recente de uso no diretório; cadastrar como incompleto para enriquecer a presença digital. Não há conclusão de inexistência de site.','pending_items':'\n'.join(pending),'priority':'media','site_status':'verificacao_pendente','evidences':ev,'diagnosis':{'fit_score':inspection['nota_sugerida'],'confidence':'baixa','summary':'Candidato de massagem identificado em diretório público. Atividade e oportunidade de página própria requerem confirmação independente.','digital_presence':f"Inspeção Playwright: {inspection['site']['situacao']}; Instagram: {inspection['instagram']['status']}; Facebook: {inspection['facebook']['status']}. Não afirmar ausência de site.",'pains':[{'pain':'Hipótese a confirmar: apresentação dos serviços pode depender do perfil no marketplace.','evidence':summary}],'opportunities':['Avaliar página própria de serviços somente após confirmar ausência de site e necessidade do negócio.'],'offer':'landing_page','offer_reason':'Possível página de apresentação dos serviços; recomendação condicionada à verificação de presença e necessidade.'}}
            path=ROOT/(slug+'.candidate.json');dump(path,candidate)
            code,check=crm('check','--file',str(path));dump(ROOT/(slug+'.check.json'),check)
            if code:raise RuntimeError('check: '+str(check))
            if check.get('status')=='existente':event({'type':'discard','url':q['url'],'reason':'duplicado'});continue
            code,result=crm('register','--run',RUN,'--file',str(path));dump(ROOT/(slug+'.register.json'),result)
            if code==4:
                event({'type':'limit','result':result});break
            if code:raise RuntimeError('register: '+str(result))
            status=result.get('status')
            if status=='existente':event({'type':'discard','url':q['url'],'reason':'duplicado'})
            elif status in ('criado','possivel_duplicado'):
                event({'type':'registered','url':q['url'],'name':name,'city':q['city'],'score':inspection['nota_sugerida'],'result':result})
                print(json.dumps({'registered':name,'score':inspection['nota_sugerida'],'result':result},ensure_ascii=False),flush=True)
            else:raise RuntimeError('unexpected register: '+str(result))
            processed+=1
        except Exception as ex:
            event({'type':'candidate_error','url':q['url'],'error':str(ex)})
            print(json.dumps({'error':str(ex),'url':q['url']},ensure_ascii=False),flush=True)
def status():
    events=[json.loads(l) for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines()]
    from collections import Counter
    print(json.dumps({'searches':searches(),'created':sum(e['type']=='registered' and e.get('result',{}).get('status')=='criado' for e in events),'review_registrations':sum(e['type']=='registered' and e.get('result',{}).get('status')=='possivel_duplicado' for e in events),'events':dict(Counter(e['type'] for e in events)),'discard_reasons':dict(Counter(e['reason'] for e in events if e['type']=='discard'))},ensure_ascii=False))
if __name__=='__main__':
    if sys.argv[1]=='discover':discover()
    elif sys.argv[1]=='process':process(int(sys.argv[2]))
    elif sys.argv[1]=='status':status()
