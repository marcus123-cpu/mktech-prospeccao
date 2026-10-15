# Hermes — pesquisa configurável, listas, funil, campanhas e dashboard

15/10/2026 · migrações `20261014170000_pesquisa_configuravel.sql` e `20261014180000_listas_kanban_dashboard.sql`

## Telas
| Tela | Para quê |
|---|---|
| `/hermes` | Nicho (texto livre), localização (**Brasil inteiro** por padrão), meta (**100** por padrão), **Iniciar pesquisa**; indicadores; últimas pesquisas com relatório |
| `/listas` | Criar, renomear, excluir listas; filtrar por nicho, cidade, estado e nota; marcar a página ou **todos os resultados filtrados**; adicionar, mover e remover |
| `/kanban` | 11 etapas, arrastar e soltar (ou seletor); histórico em `lead_kanban_events` |
| `/campanhas` | Campanhas e Disparos: criar, lista inteira, todos os elegíveis, ativar, pausar, retomar, cancelar, estatísticas e registro |
| `/execucoes` | Histórico das pesquisas (mesmo formulário e relatório) |

## Por que ~111 empresas analisadas viraram 1 lead (auditoria)
Não consegui reconstruir aquela execução específica (os dados dela estão no Supabase de produção, que não acessei).
O código e as instruções mostram os filtros que, somados, produzem esse funil:

1. **Instruções do Hermes (SKILL.md)** mandavam descartar na triagem quem não tinha telefone/Instagram visível, quem
   tinha site, quem não provasse atividade, e só cadastrar com diagnóstico completo, WhatsApp público, 2 fontes
   independentes e nota 60+ (requisitos que eram do *envio*, não do *cadastro*).
2. **A API** (`/candidates`, em execuções de pedido) recusava `verificacao_pendente`, ou seja, qualquer empresa cuja
   presença digital ainda não fora verificada.
3. **O banco** exigia telefone ou Instagram para cadastrar; e só contava na meta o lead com telefone, diagnóstico e
   nota 60+ (`hermes_run_qualified`), além de parar em 4× a meta.
4. **Duplicidade**, limite de buscas (15 por lead, até 500) e tempo máximo (retomadas).

O que mudou: cadastro aceita incompleto (telefone fixo, sem WhatsApp, nota baixa, verificação pendente; basta um
identificador: telefone, Instagram, endereço, site ou ID da fonte); a meta conta **leads novos**; só são descartados
duplicados (viram atualização), fora de nicho/localização, encerrados e quem tem site próprio sem lacuna comprovada no
Google. Os requisitos fortes continuam valendo só para o envio. Toda recusa do servidor é gravada em
`hermes_run_discards` e os motivos informados pelo Hermes (`finish --discard-reason "motivo=N"`) são somados no relatório.

## Pesquisa
- Nicho obrigatório (2 a 100 caracteres), não fixo no código. Localização: `brasil`, `estado` (UF) ou `cidade` (cidade + UF);
  nada é herdado da pesquisa anterior, e não há geolocalização/IP/GPS. A localização fica no pedido
  (`hermes_requests`), então uma pesquisa retomada mantém a sua.
- Meta: inteiro de 1 a 1000 (limite operacional). É um alvo: se as fontes, as buscas (15 por lead, 150 a 5000) ou o tempo
  (até 600 min) acabarem, o Hermes entrega o que achou e o relatório mostra `faltaram N` e o motivo.
- Relatório (`hermes_run_report`): analisadas, salvas, atualizadas, duplicidade a revisar, a enriquecer, descartadas
  (com motivos) e erros. Devolvido no `finish` e mostrado em `/hermes` e `/execucoes`.
- Presença digital (site, landing page, Instagram, link da bio, catálogo, agendamento, automação) é verificada pelo
  Hermes conforme a skill; sem confirmação, fica `verificacao_pendente` e nada é afirmado.

## Funil Kanban
Etapas: Novo, Na lista, Contatado, Aguardando resposta, Respondeu, Interessado, Proposta enviada, Negociação, Fechado,
Perdido, Não contatar. A posição vem da conversa real (envio, resposta humana, etapa comercial); um movimento manual
vale até o próximo evento real. Respostas e envios **simulados** nunca movem o funil. **Fechado** exige valor e data
confirmados (usa o registro de fechamento existente); **Perdido** exige motivo; **Não contatar** bloqueia o lead,
cancela a fila e não é desfeito pelo funil. O Hermes nunca fecha venda sozinho.

## Campanhas
Ver também [hermes-campanhas.md](hermes-campanhas.md). Pesquisa terminar não dispara nada: só campanha **ativada**.
Bloqueios obrigatórios (não contatar, contato inválido, duplicado, limites, horários, política do canal) valem também
para seleção manual. Fila persistente com chave de idempotência, pausa imediata e registro completo.

## Dashboard
Pesquisados, novos, existentes, com contato, nas listas, campanhas ativas, **preparadas** (separadas das enviadas),
enviadas, entregues (quando confirmado), respostas, interessados, propostas, negociações e vendas fechadas.

## Testes (nenhum envia mensagem real)
`tests/db/pesquisa.test.ts` (7), `tests/db/listas-kanban.test.ts` (15), `tests/db/campaigns.test.ts` (16),
`tests/unit/research-request.test.ts` (7), mais os existentes ajustados (`pedido.test.ts`).

## Limites conhecidos
- A pesquisa em si (busca na web) é feita pelo Hermes/Codex no PC; aqui foram testados o contrato, os limites e o
  relatório, não a qualidade da busca. Recomendo rodar uma pesquisa pequena (10 leads) e conferir o relatório.
- Seis testes de banco falham sem relação com estas mudanças: 4 por mensagem de erro em português do Postgres local,
  1 expectativa antiga de encaminhamento de preço, 1 que depende do horário (falha logo após meia-noite).
- Notificação de WhatsApp/entrega depende da ponte; "entregues" só conta quando a ponte confirma.
