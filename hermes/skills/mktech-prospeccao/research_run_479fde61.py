import json, subprocess, pathlib, sys
ROOT=pathlib.Path(__file__).parent
CLIENT=r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py'
RUN='479fde61-7b5e-4f02-9f8d-70d48079b569'
def save(rows):
 for r in rows:
  name,city,niche,phone,ig,services,url,summary,extra=r
  c=dict(business_name=name,city=city,state='SP',niche=niche,phone=phone,instagram=ig,services=services,source_name='busca_web',research_date='2026-10-15',website_url=None,whatsapp_url=None,site_status='verificacao_pendente',selection_reason='Negócio do nicho e cidade configurados, identificado em fonte pública; candidato incompleto para enriquecimento. Site próprio não localizado nos resultados consultados, o que não confirma ausência.',pending_items='Confirmar atividade recente por publicação ou avaliação datada; verificar site próprio e links da bio; confirmar telefone e WhatsApp comercial; obter segunda fonte independente. '+extra,priority='baixa',evidences=[dict(kind='diretorio',url=url,summary=summary,observed_at='2026-10-15',limitation='Fonte pública consultada; sem confirmação independente da atualidade dos dados e da ausência de site.')],diagnosis=dict(fit_score=35,confidence='baixa',summary=f'{name}, em {city}, consta em fonte pública com serviços do nicho {niche}. Atividade recente e oportunidade digital ainda precisam de confirmação.',audience='Público local interessado nos serviços descritos.',digital_presence=summary,pains=[dict(pain='Hipótese a confirmar: uma página própria pode reunir apresentação dos serviços e canais comerciais, caso ainda não exista.',evidence=summary)],opportunities=['Após confirmar ausência de página própria, avaliar página de apresentação dos serviços e contato.'],offer='landing_page',offer_reason='Hipótese preliminar condicionada à verificação da presença digital e da necessidade do negócio.',objections=[]))
  c['state']={'Curitiba':'PR','Londrina':'PR','Maringá':'PR','Cascavel':'PR','Fortaleza':'CE','Recife':'PE','Natal':'RN','Salvador':'BA','Itajaí':'SC','Joinville':'SC','Goiânia':'GO','Brasília':'DF','Campo Grande':'MS'}.get(city,'SP')
  c['site_status']='site_nao_localizado'
  c['evidences'].append(dict(kind='busca',summary=f'Busca nominal por {name} {city} site: não foi localizado domínio próprio atribuível nos resultados consultados. Isto não comprova ausência de site.',observed_at='2026-10-15',limitation='Resultados consultados não exaustivos; links da bio e presença própria permanecem pendentes.'))
  path=ROOT/'candidate_479fde61.json';path.write_text(json.dumps(c,ensure_ascii=False),encoding='utf-8')
  p=subprocess.run([sys.executable,CLIENT,'check','--file',str(path)],capture_output=True,text=True,encoding='utf-8',errors='replace');print(name,'CHECK',p.returncode,p.stdout,flush=True)
  if p.returncode: continue
  check=json.loads(p.stdout)
  if check.get('status')=='existente':continue
  p=subprocess.run([sys.executable,CLIENT,'register','--run',RUN,'--file',str(path)],capture_output=True,text=True,encoding='utf-8',errors='replace');print(name,'REGISTER',p.returncode,p.stdout,flush=True)
  with (ROOT/'research_479fde61_log.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'name':name,'city':city,'result':p.stdout,'code':p.returncode},ensure_ascii=False)+'\n')
  if p.returncode in (3,4,6):break
if __name__=='__main__':save(json.loads((ROOT/(sys.argv[1] if len(sys.argv)>1 else 'research_479fde61_batch.json')).read_text(encoding='utf-8-sig')))
