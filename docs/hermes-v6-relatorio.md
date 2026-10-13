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
migrações V6 de `20261013210000` a `20261013225000` e testes de unidade,
API, banco e Python.

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
Resultados executados: 247 unidade/API na regressão inicial, 9 testes das APIs
V6, 42 testes unitários V6 (14 avaliações opcionais ignoradas no comando),
40 Python de envio, 14 da ponte e 71 testes focados de banco V4/V6 após a
trava de produção. Antes, a suíte completa de banco passou em 238 casos.
As avaliações reais do modelo tiveram aprovação inicial de 13 cenários;
mudanças posteriores foram exercitadas em testes focados, sem reivindicar nova
aprovação integral. Typecheck passou; build da primeira publicação passou.
Esses números não substituem teste real de WhatsApp.

## 11. WhatsApp
Teste V6 iniciado em 13/10/2026 às 17:54 (São Paulo), sessão
`28347d50-374b-4900-a24e-7018977fca1f`, lead interno
`039520fa-aebc-4bc6-963a-f5d5f3f80500`. Saudação exclusivamente
“Olá, boa tarde! Tudo bem?” entregue: outbox
`b6ac08ab-a392-4752-bc8d-3a68ba1dc17e`, confirmação de envio às
20:54:25 UTC e entrega às 20:54:29 UTC.
Primeira resposta participativa recebida às 20:54:50 UTC: UUID
`5faff4be-3157-41a4-a368-aadbe00ca5b0`, “Olá boa tarde! Tudo bem sim aqui é a recepcionista”.
O teste revelou indicação provisória de transporte confundida com automação;
nenhuma resposta comercial foi enviada durante a recusa da validação. Contexto
e prompt corrigidos para distinguir entrada pendente de interpretação confirmada.
Apresentação enviada às 21:14:14 UTC e entregue às 21:14:28 UTC, outbox
`e5d43dae-f0e6-4420-8ee1-06bd5e1dd504`; cargo `RECEPTIONIST` confirmado.
Confirmação humana “Sim pode fala comigo”, UUID
`e295d439-f812-4585-9911-7d69166046ff`, recebida pelo WhatsApp.
Resposta contextual reconhecendo site existente, oportunidade simulada e landing
page entregue às 21:19:26 UTC, outbox `005b171d-dd7b-41a8-bca4-3450e43341bb`.
O teste também identificou cancelamento da fila por projeção automática de memória,
bloqueio indevido da palavra diagnóstico pelo filtro legado e referência histórica
UUID vs UUID:sufixo. Correções testadas; edições humanas continuam cancelando fila.
Depois, o cliente autorizou o vídeo Rosana e o link Polpujá separadamente.
O vídeo foi entregue às 21:22:56 UTC, outbox
`00211e5f-f226-4cfd-a7a2-7d456f7592b8`; o link às 21:29:07 UTC,
outbox `d16467db-bc28-476d-baeb-52c5ec67de11`. O usuário confirmou que
o vídeo reproduz e o site abre no celular. Cada material foi enviado uma vez
na sessão. A pergunta real sobre os três primeiros lugares no Google recebeu
resposta sem promessa, entregue às 21:40:39 UTC, outbox
`af3697f8-388c-4b27-962e-1b9aae622a28`. A pergunta posterior sobre a
agenda online existente recebeu resposta contextual entregue na sessão;
o sistema encaminhou a conversa por excesso de cautela sobre SEO e integração.
Essa decisão está em revisão, sem assumir que integração ou preço foram aprovados.
Uma mensagem posterior `Ok` ficou sem interpretação enquanto o humano detinha
o atendimento. Nenhum desses eventos foi simulado como mensagem recebida.
Conversa completa **ainda não validada**: faltam mensagem automática,
espera, objeção, pedido de proposta, encerramento e continuidade após reinício.
Banco, ponte e enviador seguem restritos ao número autorizado; secretário
preservado. Publicação `32632e7`, deployment
`dpl_6hpyd4ZYcqm4KnM2EfjhPGEstNk5` READY; Playwright confirmou painel
autenticado, motor V6, catálogo e pausa das novas abordagens.

## 12. Problemas encontrados
Modelo inicialmente omitiu identificação de fonte na proposta e produziu cargo
fora da lista; validação bloqueou. Prompt corrigido e avaliações repetidas.
Ambiguidade SQL entre variável e alias detectada pelo teste e corrigida.
Tabela comercial continua sem preços aprovados: o Hermes deve encaminhar,
sem inventar orçamento. Ausência de preço não autoriza improvisação.

## 13. Pendências reais
Concluir os cenários participativos restantes e o reinício, verificar as
respostas e encerrar a sessão. Registrar a validação somente após evidência
completa. Revisar fluxos de pesquisa de novos leads e métricas adaptativas
antes da liberação geral; a prontidão atual depende de pesquisa cadastrada.

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
Continua pausada. A migração `20261013225000_validacao_producao_v6.sql` exige
sessão participativa encerrada, dois materiais entregues, classificação de
intenções principais, automação, agenda existente e encerramento, antes de
permitir desligar o modo teste no painel. O registro de validação segue vazio.
SEO segue [Google Search Central](https://developers.google.com/search/docs/fundamentals/seo-starter-guide):
organizar conteúdo e melhorar acesso/indexação pode ajudar a presença na busca;
não há garantia de indexação, posição, clientes ou receita.
