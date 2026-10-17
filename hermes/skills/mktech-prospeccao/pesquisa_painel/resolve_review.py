import json,sys
from copy import deepcopy
from research import ROOT,crm,dump,event,fetch

REASONS={
 'victor.terapias.manuais':'O resultado victoreleo.com.br tem título Victor & Leo - Turnê Essência e pertence à dupla musical. Não comprova site do terapeuta Victor de Curitiba.',
 'luiza.marjorie':'Os resultados magazineluiza.com.br são do varejista Magazine Luiza, sem vínculo confirmado com Luiza Marjorie, massoterapeuta em Manaus.',
 'ali.terapeuta':'O resultado aliexpress.com é um marketplace de produtos e não confirma site próprio de Ali Terapêuta de Porto Alegre.',
 'jacqueline.silva':'O domínio jacquelineoficial.com foi encontrado apenas por busca e não abriu (HTTP 0). Titularidade e relação com a terapeuta de Manaus não foram confirmadas; manter site em verificação, sem afirmar ausência.',
 'bia.padilha':'O site biakicis.com.br tem título Site da Deputada Federal pelo DF Bia Kicis. Não confirma site da terapeuta Bia Rudá; é associação por prenome e localização.',
 'eileen.portillo':'O resultado oticascarol.com.br/brasil é da rede Óticas Carol, sem vínculo confirmado com Carol terapia de Joinville.',
 'dayane.cristiana':'O link Square é plataforma de agendamento; o título indica Studio Zen em SOMERVILLE, MA, divergente de Uberlândia. A associação do Instagram e do agendamento com a candidata precisa de verificação; não confirma site próprio.',
 'vanessa.fontes':'O site vanessadamata.com.br identifica Vanessa da Mata, sem vínculo confirmado com Vanessa fontes, massoterapeuta em Salvador.',
 'massagem.ultra.relaxante':'O resultado topmassagens.com.br/casa-de-massagens é artigo genérico de um diretório nacional (menu Encontrar Terapeutas e Criar Anúncio), não site próprio confirmado deste negócio de Porto Alegre.',
 'andrey.jaime.cavalcante':'Threads é rede social; wa.link é um redirecionador de WhatsApp. Não são site próprio. Apenas metadados públicos de apresentação foram lidos; nenhum contato foi iniciado.',
 'ayumi.kobayashi':'O endereço encontrado é um perfil TikTok, rede social, não site próprio. Site institucional e titularidade do perfil permanecem pendentes.',
 'luciana.caldas':'O resultado brterapeutas.com.br/minhapagina é perfil de diretório de terapeutas. Não é prova de site próprio; identidade Luciana Caldas/Luciana de Maria precisa ser confirmada.',
 'rose.lima':'O resultado letras.mus.br/rose é página de música, sem vínculo confirmado com o negócio de massagem de Santos.',
 'felipe.sousa':'O resultado belezanaweb.com.br/sebastian-professional é página comercial de produtos da marca Sebastian, sem vínculo confirmado com o massoterapeuta de São Luís.',
 'maya.shri':'Os resultados autodesk.com/products/maya são páginas do software Maya da Autodesk, sem vínculo com a terapeuta de Brasília.',
 'liz.massoterapeuta':'O inspetor retornou URLs /collection-liz e /roupas de liz.com.br, bloqueadas com HTTP 403. Não há vínculo confirmado com a massoterapeuta de Manaus; resultado ambíguo, não prova site do negócio.',
 'pamela.pantera.12':'O resultado letras.mus.br/pamela é página de músicas, sem vínculo confirmado com a massoterapeuta de Campo Grande.',
 'anny.dos.anjos':'Os resultados letras.mus.br/anny são páginas de músicas, sem vínculo confirmado com a massoterapeuta de Manaus.',
 'laila.teixeira':'Os resultados do G1 são notícias sobre Laíla, diretor de carnaval do Rio de Janeiro. São homônimos, não site da massoterapeuta de Vitória.',
 'mariana.rezende':'O resultado letras.mus.br/galinha-pintadinha é página de música. Não comprova site da massoterapeuta de Joinville.',
 'dayane.afonso.1':'Threads @estudio_zen_udi é rede social, não site próprio. O título confirma Dayane, massoterapeuta em Uberlândia. Link wa.me não foi aberto.'
}
queue=json.loads((ROOT/'queue.json').read_text(encoding='utf-8'))
for slug,reason in REASONS.items():
    url='https://euterapeuta.com.br/'+slug
    events=[json.loads(l) for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines()]
    if any(e.get('url')==url and e['type'] in ('registered','discard') for e in events):continue
    if sum(e['type']=='registered' for e in events)>=100:break
    ip=ROOT/(slug+'.inspection.json')
    if not ip.exists():continue
    q=next(q for q in queue if q['url']==url)
    ins=json.loads(ip.read_text(encoding='utf-8'))
    soup=fetch(url);name=soup.select_one('h1').get_text(' ',strip=True)
    tel=soup.select_one('a[href^="tel:"]');phone=tel.get_text(' ',strip=True) if tel else None
    services=list(dict.fromkeys(a.get_text(' ',strip=True) for a in soup.select('a[href]') if '/terapeutas/' in a['href'] and a.get_text(' ',strip=True)))
    ev=deepcopy(ins['evidencias'])
    for e in ev:e['limitation']=reason+' Classificação automática do inspetor não confirma a titularidade ou a natureza de site próprio.'
    summary=f"{name}; {q['city']} - {q['state']}; contato público: {phone or 'não informado'}; serviços: {', '.join(services)}."
    ev += [{'kind':'diretorio','url':url,'summary':summary,'observed_at':'2026-10-16','limitation':'Informações do anunciante no marketplace, sem validação independente.'},{'kind':'diretorio','url':q['listing_url'],'summary':q['listing_text'],'observed_at':'2026-10-16','limitation':'Visto há é acesso ao diretório, não publicação ou prova de atendimento.'},{'kind':'outro','url':url,'summary':'Revisão da inspeção automática: '+reason,'observed_at':'2026-10-16','limitation':'Site próprio permanece por verificar.'}]
    if slug=='dayane.afonso.1':
        ev.append({'kind':'outro','url':'https://www.threads.com/@estudio_zen_udi','summary':'Página Threads aberta pelo inspetor com título: Dayane| Massoterapeuta Uberlândia (@estudio_zen_udi).','observed_at':'2026-10-16','limitation':'Rede social; sem data recente de publicação comprovada.'})
    c={'business_name':name,'city':q['city'],'state':q['state'],'niche':'Massagem','services':services,'phone':phone,'instagram':ins['instagram'].get('handle') or None,'website_url':None,'whatsapp_url':None,'source_name':'euterapeuta','source_place_id':'euterapeuta:'+slug,'research_date':'2026-10-16','site_status':'verificacao_pendente','priority':'media','selection_reason':'Candidato de massagem com sinal de uso recente no diretório. A revisão não confirmou site próprio; cadastrar com pendências, sem afirmar ausência.','pending_items':'Confirmar atividade de atendimento e presença digital em fonte independente. Confirmar eventual site/landing page. Localizar ou conferir redes oficiais e bio. Confirmar telefone e WhatsApp comercial. '+reason,'evidences':ev,'diagnosis':{'fit_score':ins['nota_sugerida'],'confidence':'baixa','summary':'Candidato incompleto. '+reason,'digital_presence':'Presença de site próprio permanece pendente. Classificação automática revisada com limitação explícita.','pains':[{'pain':'Hipótese a confirmar: apresentação dos serviços depende de plataforma de terceiros.','evidence':summary}],'opportunities':['Avaliar página própria após confirmar ausência de site e necessidade do negócio.'],'offer':'landing_page','offer_reason':'Hipótese de página de serviços condicionada à verificação; não é mensagem comercial.'}}
    path=ROOT/(slug+'.candidate.json');dump(path,c)
    code,result=crm('check','--file',str(path));dump(ROOT/(slug+'.check.json'),result)
    if code:raise RuntimeError(str(result))
    if result.get('status')=='existente':event({'type':'discard','url':url,'reason':'duplicado'});continue
    code,result=crm('register','--run','a530496c-7627-4e51-a4dc-1a1c2cef6956','--file',str(path));dump(ROOT/(slug+'.register.json'),result)
    if code==4:event({'type':'limit','result':result});break
    if code:raise RuntimeError(str(result))
    if result.get('status')=='existente':event({'type':'discard','url':url,'reason':'duplicado'});continue
    if result.get('status') not in ('criado','possivel_duplicado'):raise RuntimeError(str(result))
    event({'type':'registered','url':url,'name':name,'city':q['city'],'score':ins['nota_sugerida'],'result':result,'manual_review':reason})
    print(json.dumps({'registered':name,'score':ins['nota_sugerida']},ensure_ascii=False),flush=True)
