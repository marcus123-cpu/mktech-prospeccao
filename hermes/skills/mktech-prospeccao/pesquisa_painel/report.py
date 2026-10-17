import json,re,sys
from collections import Counter
from research import ROOT,RUN,crm,dump,searches
events=[json.loads(l) for l in (ROOT/'events.jsonl').read_text(encoding='utf-8').splitlines()]
created=[e for e in events if e['type']=='registered' and e.get('result',{}).get('status')=='criado']
reviews=[e for e in events if e['type']=='registered' and e.get('result',{}).get('status')=='possivel_duplicado']
discarded={e['url']:e for e in events if e['type']=='discard'}
reasons=Counter(e['reason'] for e in discarded.values())
resolved={e['url'] for e in events if e['type']=='error_resolved'}
errors=sum(e['type']=='inspection_error' for e in events)+sum(e['type']=='candidate_error' and e['url'] not in resolved for e in events)
counts={'run_id':RUN,'created':len(created),'review_registrations':len(reviews),'discarded':len(discarded),'discard_reasons':dict(reasons),'errors':errors,'corrected_validation_errors':len(resolved),'searches_min':searches(),'searches_max':searches()+1}
def safe_name(name):
    name=re.sub(r'[^\w\s|()&.,áéíóúâêôãõçàÁÉÍÓÚÂÊÔÃÕÇÀ-]',' ',name)
    name=re.split(r'\s+\d+\s*anos|WHATS|\(\d{2}\)|R\s*\$|Relaxante\s+Nuru',name,flags=re.I)[0]
    return re.sub(r'\s+',' ',name).strip().strip('|')
def table(rows):
    lines=['| Nome comercial | Cidade | Nota da inspeção | Oportunidade condicional |','|---|---|---:|---|']
    for e in sorted(rows,key=lambda e:(e['city'],e['name'])):
        lines.append(f"| {safe_name(e['name']).replace('|','/')} | {e['city']} | {e['score']} | Landing page, após verificar site e necessidade |")
    return lines
lines=[f'# Pesquisa do painel — Massagem / Brasil',f'Execução: `{RUN}`','',f"Novos leads criados: {len(created)}. Encaminhados para revisão de duplicidade: {len(reviews)}. Descartados: {len(discarded)}. Falhas de inspeção ou erros não resolvidos: {errors}. Recusas de validação corrigidas: {len(resolved)}.",'',f"Buscas: {searches()} a {searches()+1}. A primeira inspeção Playwright falhou antes da instrumentação: houve uma ou duas consultas Bing. As demais buscas foram registradas individualmente. No encerramento, utiliza-se o limite superior conservador.",'','Todos os cadastros mantêm pendências explícitas; não representam confirmação de ausência de site nem elegibilidade para envio. A nota original da inspeção foi preservada, inclusive nos falsos vínculos com sites de homônimos documentados no CRM. Oportunidades são hipóteses de diagnóstico, não mensagens nem ofertas enviadas.','',f"Descartes: "+'; '.join(f'{r}: {n}' for r,n in reasons.items())+'.','','## Novos leads','']+table(created)
if reviews:lines+=['','## Revisão de possível duplicidade — fora da contagem de novos','']+table(reviews)
(ROOT/'relatorio.md').write_text('\n'.join(lines)+'\n',encoding='utf-8');dump(ROOT/'summary.json',counts)
if len(sys.argv)>1 and sys.argv[1]=='finish':
    limit=any(e['type']=='limit' for e in events)
    if len(created)<100 and not limit:raise RuntimeError('Meta ainda não atingida e nenhum limite CRM registrado.')
    args=['finish','--run',RUN,'--status','concluida','--searched',str(searches()+1),'--approved',str(len(created)),'--discarded',str(len(discarded)),'--errors',str(errors),'--end-reason','Meta de novos leads atingida.' if len(created)>=100 else 'CRM retornou código 4 de limite; encerrado com os números reais de novos e revisões.','--notes',f"{len(created)} novos; {len(reviews)} revisões de duplicidade fora da meta; pendências preservadas. Buscas entre {searches()} e {searches()+1}: primeira inspeção sem telemetria fez 1 ou 2 consultas, restante medido. --searched usa teto conservador. {len(resolved)} validações corrigidas. Nenhuma mensagem comercial criada ou contato iniciado.",'--error-detail',f'{errors} falhas de inspeção Playwright registradas. A inspeção inicial de Luci Massagem Flow não foi concluída; demais falhas tiveram repetição. Recusas de telefone, Instagram e nome tipográfico corrigidas separadamente.']
    for r,n in reasons.items():args+=['--discard-reason',f'{r}={n}']
    code,result=crm(*args);dump(ROOT/'finish.json',result)
    if code:raise RuntimeError(str(result))
    print(json.dumps({'finish':result,'counts':counts},ensure_ascii=False))
else:print(json.dumps(counts,ensure_ascii=False))
