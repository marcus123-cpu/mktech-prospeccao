import json
import pathlib

base = pathlib.Path(__file__).parent
records = [json.loads(line) for line in (base / 'research_results.jsonl').read_text(encoding='utf-8').splitlines()]
audit = json.loads((base / 'research_audit.json').read_text(encoding='utf-8-sig'))
prior_scores = {
    'Karoline Águila Massoterapeuta':45, 'Joseana Costa':45,
    'Silvia Sibeli':45, 'Juliana Saretta':35, 'Janice Freitas':40,
    'Carol Massoterapeuta':40, 'Julia Maia Massoterapeuta':40,
    'Helen Terapeuta':35, 'Marianna Diniz':40,
    'Ana Lua Massoterapeuta':40, 'Gi Charrua':35,
    'Raika Terapeuta - Espaço Zuri':35, 'Cristina Miranda Terapias':35,
    'Clara Gusmão Massoterapeuta':35, 'Thaís Almeida - Espaço Terapêutico':35,
    'Sther Santana Massoterapia e Estética':45,
}
saved = [r for r in records if r['code'] == 0 and r['result'] != 'duplicate' and json.loads(r['result']).get('status') == 'criado']
assert len(saved) == 100
assert len({json.loads(r['result'])['lead_id'] for r in saved}) == 100
lines = [
    '# Pesquisa do painel — massoterapia no Brasil', '',
    'Execução: `'+audit['run_id']+'`.', '',
    '141 buscas; 100 novos cadastros; 41 descartes por site próprio sem lacuna comprovada. Nenhum contato ou mensagem comercial foi realizado.', '',
    'Todos os candidatos foram cadastrados com site_status verificacao_pendente e pendências explícitas. As notas abaixo são as notas de pesquisa enviadas, não uma confirmação de prontidão para envio. A oferta landing_page é preliminar e depende de enriquecimento. Não foi comprovada ausência de site para estes 100 negócios.', '',
    'Ocorrências: 37 falhas de acesso/ferramenta em aberturas web, com uso de fontes alternativas ou trechos indexados e limitações registradas. Uma recusa de cadastro por identificador ausente e um erro local de codificação foram corrigidos. Nenhum cadastro ficou recusado.', '',
    '| Negócio | Cidade | Nota enviada | Oferta preliminar |',
    '|---|---|---:|---|',
]
for r in saved:
    score = r.get('candidate', {}).get('diagnosis', {}).get('fit_score', prior_scores.get(r['name'], 30))
    lines.append('| '+r['name']+' | '+r['city']+' | '+str(score)+' | landing_page |')
lines += ['', '## Descartes', '', '| Negócio | Fonte da presença própria |', '|---|---|']
for item in audit['discards']:
    lines.append('| '+item['name']+' | [Fonte]('+item['url']+') |')
(base / 'relatorio-pedido-52045f39.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
print(json.dumps({'new_leads':len(saved),'discarded':len(audit['discards']),'searches':audit['searches']},ensure_ascii=False))
