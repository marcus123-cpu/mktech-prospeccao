# Hermes V6 — implementação e validação

Estado: **em validação; produção pausada**. Teste participativo autorizado somente
em +55 17 99225-0729. Não declarar conclusão enquanto faltar evidência real.

## 1. Diagnóstico anterior
Auditoria em `hermes-v6-auditoria.md`. O V4 utilizava regras e textos fixos,
privilegiava a última mensagem classificada como humana e podia confundir
automação de agenda com atendimento humano. Identificação como Marcos era inadequada.

## 2. Arquivos
Motor modular em `src/lib/commercial/v6/`; APIs `comercial/contextos` e
`comercial/decidir`; adaptador `envio/modelo-hermes.py`, supervisor
`envio/commercial_model.py`, worker `envio/comercial-loop.py`; painel comercial;
migração `20261013210000_conversacao_v6.sql` e testes V6 em unidade/API/banco/Python.

## 3. Serviços
Mantidos Next.js, Supabase, Hermes instalado e ponte WhatsApp existente.
O modelo configurado no Hermes roda em processo isolado, sem ferramentas,
memória global, arquivos de identidade ou sessão compartilhada entre clientes.
O modelo propõe; o servidor valida; a fila e o transporte confirmam o envio.

## 4. Banco
Reserva temporária por conversa e token, snapshot, revisão, classificação múltipla
por entrada, memória por lead, prontidão e fase. Novas entradas invalidam decisões
em preparação. Catálogo, consentimento, CRM e resultados anteriores preservados.
Sessões de teste explicitamente identificadas guardam snapshots e resultados;
deduplicação de demonstração permanece exclusiva por lead em produção e por
sessão no teste autorizado. Backup anterior à migração guarda os 87 leads atuais.

## 5. Fluxo
Pesquisa suficiente → saudação local → esperar resposta → interpretar contexto →
identificar assistente comercial da MKTech Dev → confirmar canal → oportunidade
verificável → solução adequada → permissão de demonstração → entrega confirmada.
Automação ou interpretação incerta aguarda. Recusa encerra. Não há aprovação
manual por envio; permanecem autorização do cliente e verificações técnicas.

## 6. Memória
Resumo, fatos com fonte e trecho literal, dúvidas, perguntas, objeções, solução,
canal, retorno e próxima ação persistem na ficha existente. Apresentação e
reconhecimento de espera somente são confirmados após resultado do transporte.

## 7. Classificação
Cada entrada tem UUID e múltiplas intenções com confiança e evidência. Classificação
do transporte é provisória no V6. Entrada automática posterior integra o contexto;
não é ignorada em favor de mensagem humana mais antiga. Mensagens rápidas são
agrupadas. Payload do cliente não pode substituir o snapshot do servidor.

## 8. Diagnóstico
Nome, cidade, serviços comprovados, fontes independentes, diagnóstico, oportunidade
e fuso são exigidos antes da prospecção. Prontidão aparece no painel. Informação
de site/agenda recebida do cliente é preservada com origem, sem inventar necessidade.
No teste autorizado, diagnóstico demonstrativo é explicitamente identificado como simulação.

## 9. Demonstrações
`hermes/videos-demonstracao/landing-pages/rosana-landing-page.mp4` e
`https://www.xn--polpuj-uta.com.br/`, IDs `DEMO_ROSANA_LANDING` e
`DEMO_POLPUJA_VITRINE`. Arquivo persistente relativo ao projeto; original preservado.
O serviço confirma disponibilidade. Oferta, permissão, reserva, envio e entrega
têm registros distintos. Não há reenvio automático de resultado desconhecido.

## 10. Testes automatizados
Resultados executados: 247 unidade/API na regressão inicial e 8 testes adicionais
das APIs V6 aprovados; 31 Python de envio; 14 da ponte; 238 na suíte completa
de banco. Foram aprovadas 13 avaliações reais do modelo (6 de conversa e 7 de
soluções/objeções). Typecheck e build passaram. Migração aplicada sob pausa.
Esses números não substituem teste real de WhatsApp.

## 11. WhatsApp
Teste V6 iniciado em 13/10/2026 às 17:54 (São Paulo), sessão
`28347d50-374b-4900-a24e-7018977fca1f`, lead interno
`039520fa-aebc-4bc6-963a-f5d5f3f80500`. Saudação exclusivamente
“Olá, boa tarde! Tudo bem?” entregue: outbox
`b6ac08ab-a392-4752-bc8d-3a68ba1dc17e`, confirmação de envio às
20:54:25 UTC e entrega às 20:54:29 UTC. Ainda aguardando resposta participativa;
Primeira resposta participativa recebida às 20:54:50 UTC: UUID
`5faff4be-3157-41a4-a368-aadbe00ca5b0`, “Olá boa tarde! Tudo bem sim aqui é a recepcionista”.
O teste revelou indicação provisória de transporte confundida com automação;
nenhuma resposta comercial foi enviada durante a recusa da validação. Contexto
e prompt corrigidos para distinguir entrada pendente de interpretação confirmada.
Conversa completa e demonstrações V6 **não validadas ainda**. Envios anteriores
do V4 não substituem a prova do novo motor. Banco, ponte e enviador restritos ao
número autorizado; secretário preservado. Publicação `bed2a03`, deployment
`dpl_2ns8iZ3zuafJ9wAejTjU2jVoz2PA` READY; Playwright confirmou painel autenticado,
motor V6, catálogo e botão de pausa das novas abordagens.

## 12. Problemas encontrados
Modelo inicialmente omitiu identificação de fonte na proposta e produziu cargo
fora da lista; validação bloqueou. Prompt corrigido e avaliações repetidas.
Ambiguidade SQL entre variável e alias detectada pelo teste e corrigida.
Tabela comercial continua sem preços aprovados: o Hermes deve encaminhar,
sem inventar orçamento. Ausência de preço não autoriza improvisação.

## 13. Pendências reais
Confirmar publicação sob pausa e executar teste participativo
(incluindo demonstrações, retomada e reinício),
documentar evidências e somente então avaliar liberação de produção.

## 14. Iniciar
`envio/iniciar-tudo.bat` mantém ponte, enviador e workers. O runtime Hermes precisa
permanecer instalado e autenticado. Falha de inferência aplica espera e notificação.
Em `/comercial`, **Pausar novas abordagens** preserva atendimento; **Pausar operação**
suspende a reserva geral. Não usar `parar-tudo.bat` para pausar só prospecção.

## 15. Modo de teste
Motor V6 e restrição de telefones em `/comercial`. Banco e `ENVIO_SO_PARA`
precisam concordar. Alteração da restrição local exige reiniciar ponte/enviador.
Não liberar a restrição local enquanto a validação estiver pendente.

## 16. Produção
Continua pausada. A ativação inicial do V6 exige modo teste. Só liberar após
verificação completa, revisão das pendências e evidência participativa real.
SEO segue [Google Search Central](https://developers.google.com/search/docs/fundamentals/seo-starter-guide):
organizar conteúdo e melhorar acesso/indexação pode ajudar a presença na busca;
não há garantia de indexação, posição, clientes ou receita.
