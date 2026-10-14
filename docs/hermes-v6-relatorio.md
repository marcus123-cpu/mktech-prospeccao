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
V6, 44 testes unitários V6 (14 avaliações opcionais ignoradas no comando),
41 Python de envio, 14 da ponte e 71 testes focados de banco V4/V6 após a
trava de produção. Antes, a suíte completa de banco passou em 238 casos.
As avaliações reais do modelo tiveram aprovação inicial de 13 cenários. Uma
comparação isolada posterior com `gpt-6-luna` aprovou 14 cenários (saudação,
automação, recusa, injeção, serviços, agenda, SEO e preço) em dois grupos de
aproximadamente 97 e 100 segundos; falta medir a latência desse modelo no
contexto completo do WhatsApp. Typecheck passou; build da publicação passou.
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
Depois, o cliente pediu retorno e proposta/preço em mensagem real às 01:12:33 UTC
de 14/10. O Hermes respondeu sem inventar orçamento, com entrega às 02:14:22 UTC;
o atraso incluiu indisponibilidade temporária do provedor de inferência. A pergunta
real de reunião às 02:14:59 UTC teve resposta entregue às 02:24:18 UTC, deixando
claro que a reunião dependia de confirmação da equipe. Esses dois encaminhamentos
ativaram indevidamente o controle humano e impediram a resposta imediata à objeção
real, recebida às 02:25:32 UTC. A regra foi corrigida: perguntas comerciais usuais
podem receber resposta segura e notificação à equipe, mantendo o bot disponível;
pedido explícito de humano ou assunto sensível ainda transfere o controle. Após
devolver apenas o contato de teste ao bot, a objeção sobre custo e agenda online
foi interpretada como `OBJECTION+BUSINESS_QUESTION` e respondida sem preço ou
promessa; mensagem entregue às 02:33:10 UTC. Esse intervalo **não é medição de
latência normal**, pois a mensagem ficou retida sob controle humano. A fase antiga
`HUMAN_HANDOFF` após devolução foi corrigida e a implantação `1913d89` está READY.
Uma nova pergunta humana sobre Instagram entrou às 02:35:14 UTC já com o bot ativo.
Decisão às 02:35:53 UTC, envio às 02:35:56 UTC e entrega às 02:36:00 UTC:
**43 segundos até envio e 46 segundos até entrega**. A resposta contextual foi
correta e a fase ficou `QUALIFYING`. A meta de 20 segundos não passou.
O polling local foi reduzido de 30 para 3 segundos e removida
a espera fixa de 30 segundos no início do enviador. O modelo ainda pode levar
mais de 20 segundos; o limite solicitado não foi demonstrado. Os workers locais
comerciais foram reiniciados com a ponte e o secretário mantidos ativos. O cliente
enviou uma recusa real às 02:40:14 UTC, classificada como `OPT_OUT` às 02:40:40
UTC; o lead foi bloqueado e a conversa encerrada. Uma migração de auditoria
marcou também `outreach_replies.opt_out=true`. Depois o titular reautorizou
explicitamente, pelo Codex, continuar **somente o teste no próprio número**;
o lead de teste voltou a `QUALIFYING`, e a recusa original segue auditada.

Conversa completa **ainda não validada**: a automação foi confirmada depois do
envio único descrito abaixo; falta medir uma nova resposta humana após reinício
com o modelo rápido. A latência real medida
com `gpt-6-sol` excede o limite solicitado. `gpt-6-luna` foi configurado apenas
no worker local de teste após passar os 14 cenários isolados; uma inferência
isolada com contexto comercial anterior levou 10,05 segundos, sem WhatsApp.
Um ajuste de raciocínio ainda mais leve falhou em 2 dos 14 cenários e foi
descartado. O limite de 20 segundos ainda precisa de medição real com esse modelo.
Banco, ponte e enviador seguem restritos ao
número autorizado; secretário preservado. Playwright confirmou anteriormente
painel autenticado, motor V6, catálogo e controle de novas abordagens.

Às 02:46:21 UTC o titular escreveu “Ativada” no WhatsApp. A entrada foi
corretamente interpretada como incerta, mas o modelo encerrou a conversa por
reaplicar a recusa histórica. Corrigimos a validação para exigir recusa ou canal
errado na **mensagem atual** antes de encerrar; `941352a` está publicado. O
contato de teste foi restaurado com a reautorização explícita registrada na
memória, sem apagar o opt-out anterior. Um único teste de resposta automática
foi enviado às 02:54:37 UTC e entregue às 02:54:41 UTC. Até a última checagem,
nenhuma resposta automática havia chegado; não houve segundo envio. A mensagem
de ausência genuína chegou às 02:58:03 UTC, foi interpretada como `automated`
com `AUTOMATED_GREETING+WAIT_REQUEST` e decisão `wait` às 02:58:33 UTC.
Nenhuma resposta saiu para a automação e nenhum retorno às 8h foi agendado.
Resta medir uma nova pergunta humana com o modelo mais rápido; só então encerrar
a sessão e avaliar o registro de validação para produção.

## 12. Problemas encontrados
Modelo inicialmente omitiu identificação de fonte na proposta e produziu cargo
fora da lista; validação bloqueou. Prompt corrigido e avaliações repetidas.
Ambiguidade SQL entre variável e alias detectada pelo teste e corrigida.
Tabela comercial continua sem preços aprovados: o Hermes deve encaminhar,
sem inventar orçamento. Ausência de preço não autoriza improvisação.

## 13. Pendências reais
Concluir os cenários participativos restantes e o reinício, reduzir a latência
real, verificar o resultado e encerrar a sessão. Registrar a validação somente após evidência
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
