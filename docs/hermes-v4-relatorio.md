# Hermes Prospector V4 — entrega técnica

13/10/2026 · MKTech Dev · responsável: Marcos

## 1. Diagnóstico da versão anterior

A auditoria foi registrada antes da implementação em [hermes-v4-auditoria.md](hermes-v4-auditoria.md).
O projeto já oferecia pesquisa Hermes, normalização brasileira, deduplicação,
históricos, RLS, autenticação administrativa, fila exclusiva, atendimento manual,
memória e métricas calculadas no Postgres. Essas bases foram preservadas.

## 2. Problemas identificados

A abordagem antiga proibia apresentar o serviço; o secretário proibia preço e
material visual. Pesquisa descartava clínicas com site, lembretes não exigiam
combinado, entradas da ponte existiam somente em memória e timeout era tratado
como falha confirmada. Não havia identificação estruturada de decisores,
experimento A/B/C, consentimento de vídeo nem vinte etapas comerciais.

## 3. Arquitetura implementada

Não foram criados dez agentes. A pesquisa continua no Hermes. Verificação e
qualificação usam evidências e critérios do servidor. Estratégia é alocada no
Postgres. Conversação, identificação de interlocutor, apresentação e negociação
ficam em `src/lib/commercial/engine.ts`. A API de processamento recupera contexto,
gera decisão, calcula score e grava a versão correta. Um worker Python chama essa
API; a fila SQL arbitra os envios, e a ponte executa texto ou vídeo aprovado.

O motor é determinístico, com regras para os cenários definidos. Respostas fora
desse repertório são encaminhadas a Marcos; não existe geração livre de fatos,
preços ou compromissos contratuais. O histórico persistido e a memória comercial
complementam as últimas cem mensagens fornecidas ao processamento.

## 4. Arquivos alterados ou criados

| Área | Arquivos |
|---|---|
| Banco | `supabase/migrations/20261013141307_hermes_v4.sql` |
| Motor | `src/lib/commercial/engine.ts`, `src/lib/commercial/labels.ts` |
| Painel | `src/app/(painel)/comercial/page.tsx`, `actions.ts`, `src/components/Nav.tsx` |
| Conversas existentes | `src/lib/conversations.ts`, `src/app/(painel)/conversas/page.tsx`, `actions.ts` |
| API | `comercial/processar/route.ts`, `comercial/conexao/route.ts`, `candidates/route.ts`, `envio/respostas/route.ts`, `envio/[id]/resultado/route.ts`, `src/lib/hermes/schemas.ts` |
| Classificação | `src/lib/envio/respostas.ts` |
| Ponte e transporte | `envio/whatsapp-web/bridge.js`, `journal.js`, `envio/mktech_envio.py` |
| Worker e inicialização | `envio/comercial-loop.py`, `.bat`, `envio/iniciar-tudo.bat`, `envio/parar-tudo.bat`, `envio/env-exemplo.txt` |
| Pesquisa | `hermes/skills/mktech-prospeccao/SKILL.md`, `scripts/mktech_crm.py` |
| Testes | `tests/unit/commercial.test.ts`, `tests/api/commercial-routes.test.ts`, `tests/db/commercial-v4.test.ts`, `tests/db/helpers.ts`, `reset.ps1`, `envio/tests/test_commercial_v4.py`, `envio/whatsapp-web/journal.test.cjs` |
| Documentação e comandos | `README.md`, `.gitignore`, `package.json`, estes dois relatórios |

Alterações pré-existentes em `envio/preparador-loop.bat`, `.new` e `.bak-20261013`
não foram modificadas por esta implementação.

## 5. Estratégias comerciais

A apresenta MKTech e pede abertura para mostrar uma ideia. B faz uma pergunta
consultiva e adapta a pergunta quando o site já está confirmado. C oferece vídeo,
sem enviá-lo no primeiro contato. Nenhuma abordagem afirma ter visto um Instagram
sem evidência nem garante pacientes ou faturamento.

O experimento aloca até dez leads por grupo, equilibrando cidade e faixa de score,
com desempate estável por identificador. A estratégia permanece registrada. Ao
atingir a quota, novas alocações experimentais param. Não há escolha automática de
vencedora nem mudança automática de estratégia de produção.

## 6. Recepcionistas e proprietárias

Cargo exige declaração explícita ou correção administrativa com evidência.
Recepcionista recebe uma pergunta educada sobre quem avalia propostas digitais.
Intermediária autorizada pode avaliar ou encaminhar sem insistência na dona.
Encaminhamento é registrado; ausência da responsável gera combinação de horário
ou oferta de material. Proprietária, gerente e marketing podem receber a
apresentação. Recusa da responsável encerra o contato; não há busca de canal
alternativo para contorná-la.

## 7. Apresentação e vídeo

Consentimento é contextual: uma resposta afirmativa autoriza vídeo quando atende
à oferta de vídeo da conversa. Um “sim” isolado em outro contexto não autoriza.
O envio usa IDs do catálogo aprovado em `hermes/videos-demonstracao`: vídeo da
Rosana para landing page/portfólio e link da Polpujá para vitrine/produtos.
Não existe download de URL arbitrária fornecida pelo cliente.

O vídeo é reservado uma única vez, não recebe data de envio quando enfileirado e
só muda para enviado após confirmação do transporte. Entrega exige evento próprio.
O sistema não presume que o material foi assistido. Recusar o vídeo não provoca
novo oferecimento automático.

## 8. Negociação

Preços vêm de produtos aprovados no painel. Há uma opção aprovada por escopo,
com preço, condições e prazo opcional. Landing page, site institucional e
agendamento usam suas próprias tabelas; um preço de landing não é aplicado a
agendamento. Não há preço padrão ou desconto fictício.

O modelo automático de proposta cobre landing page e contato pelo WhatsApp, após
confirmar procedimentos e canal. A proposta só entra no CRM depois do envio
confirmado. Outros escopos de proposta, desconto especial, contrato, reclamação,
pagamento informado por texto e intenção de contratação passam a Marcos.
Editar a tabela cancela preços/propostas pendentes afetados e encaminha essas
conversas para revisão. Venda e receita dependem do fechamento confirmado na
ficha existente; intenção de compra não confirma pagamento.

## 9. CRM e qualificação

Vinte etapas comerciais convivem com os enums antigos, preservando histórico.
Mudanças têm data, origem e motivo. Score de oportunidade tem os pesos 20/25/15/
15/15/10; confiança é separada. Falta de site em busca não dá pontos de
oportunidade. Atividade recente exige data de atividade observada, não apenas
data de verificação. Fontes limitadas não recebem pontuação plena.

Endereço comercial e URL de agendamento podem ser pesquisados e armazenados.
Nome e endereço normalizados ajudam na deduplicação; endereço compartilhado ou
sinais conflitantes vão para revisão. Atualização de duplicado preserva contatos,
status, notas e negociação. Leads em negociação não recebem nova primeira
abordagem. Correções de memória e classificação invalidam decisões pendentes.

Silêncio após dois dias úteis marca sem resposta, sem gerar cobrança. Retornos
são agendados somente com fundamento explícito: data ISO, data brasileira ou
“amanhã” com horário definido. Datas ou horários ambíguos são esclarecidos. Cada
combinado gera no máximo um retorno; encerramento cancela acompanhamentos.

## 10. Dashboard

`/comercial` mostra indicadores SQL, funil, coortes experimentais, notificações,
últimas conexões do Hermes/enviador, estado do WhatsApp e fichas paginadas. A ficha
apresenta score, confiança, cargo/evidência, estratégia, fatos, vídeo, próxima data,
fila, decisões e histórico de etapas. A ficha antiga continua reunindo fontes,
notas, propostas e contatos. A central de conversas inclui saídas V4.

O painel permite ativar, pausar, alterar estratégia/limites, editar tabela,
corrigir cargo/etapa/elegibilidade e assumir/devolver conversa. Assumir cancela
mensagens ainda não reservadas. Se uma já está saindo, a interface pede aguardar
sua confirmação: não promete cancelar uma transmissão em andamento.

## 11. Integrações

Supabase Auth/Postgres e RLS existentes, Hermes Agent de pesquisa, script CRM
Python, ponte `whatsapp-web.js` e transporte Python foram preservados. Não foram
adicionadas dependências de aplicação, MCPs ou plugins. A CLI Supabase foi usada
como ferramenta para criar o arquivo de migração. Notificações ficam no dashboard;
Telegram não foi integrado nesta entrega.

A ponte existente é WhatsApp Web; esta entrega não a converte em API oficial
Meta. Autorização do canal e elegibilidade dos contatos precisam estar verificadas
antes da operação real. Sessão conectada e telefone público não bastam para isso.

## 12. Testes executados

Unidade/API, contratos Python, Postgres local isolado com todas as migrações,
journal da ponte, TypeScript, build Next e verificação de segredos do bundle.
Cobertura inclui os 25 cenários pedidos e casos adicionais de concorrência,
entrega, atualização de catálogo, regeneração após correção, retorno em português,
respostas automáticas posteriores a perguntas humanas e controle de acesso.

## 13. Resultados

Validação final com a versão recente de produção incorporada: 201 testes de unidade/API,
203 testes Postgres, 22 testes Python da integração CRM, 26 do enviador e 14 da ponte (466 no total). TypeScript,
build Next e inspeção de segredos passaram. O detalhe da biblioteca está em
`docs/hermes-demonstracoes.md`.
As suítes usam dados sintéticos e servidores locais. Na validação de produção,
somente o contato interno previamente cadastrado recebeu os dois materiais,
ambos com entrega confirmada e sem duplicação após reiniciar. Durante a validação, um conflito de alias SQL na marcação de sem resposta
foi identificado e corrigido; a suíte completa foi executada novamente.

## 14. Pendências e limites

- As três migrações foram aplicadas em produção, o painel foi publicado e a skill
  instalada no Hermes foi atualizada, preservando seu `.env` e os candidatos.
- O MP4 real foi copiado e validado. Tabela oficial e telefone de teste ainda
  precisam ser configurados; nenhum desses valores foi inventado.
- Vídeo e link foram entregues no telefone interno. A reconexão foi validada sem
  novo QR, e resultados persistiram após reiniciar. O canal permanece em modo teste.
- Pesquisa real depende do Hermes e de seu provedor de busca. Foi validado o
  contrato existente de cadastro/deduplicação, não uma rodada externa de pesquisa.
- Motor determinístico encaminha situações sem interpretação confiável. Não faz
  contratos, confirmação bancária, proposta livre ou tratamento de áudio por IA.
- Resultado desconhecido exige reconciliação na ponte; não há reenfileiramento
  automático. O journal contém dados comerciais locais e deve ser preservado.
- Playwright verificou acesso administrativo autenticado a `/comercial`,
  `/conversas`, `/leads` e `/execucoes`, todos HTTP 200, com os dois materiais visíveis.

## 15. Como executar

1. Faça backup do banco e aplique as migrações V4 e catálogo **depois** das anteriores:
   `20261013141307_hermes_v4.sql` e `20261013152458_catalogo_demonstracoes.sql`.
   Aplicar também `20261013165000_demo_response_reconciliation.sql`.
   Não execute scripts de reset no Supabase.
2. Atualize painel, ponte e transporte juntos. O protocolo da ponte passou a
   confirmar entradas com ACK; não misture ponte nova com enviador antigo.
3. Execute `npm run build` e `npm run start`. Abra `/comercial` com usuário admin.
4. Atualize a skill externa:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\hermes\instalar-skill.ps1 -Force
   ```

5. Configure `envio/.env` usando o exemplo, preservando os segredos existentes:
   `MKTECH_CRM_URL`, `MKTECH_ENVIO_TOKEN` (escopo `envio:operar`),
   `MKTECH_COMMERCIAL_TOKEN` (escopo `mensagens:escrever`), `BRIDGE_TOKEN`,
   `HERMES_DEMO_ROOT` (opcional; biblioteca relativa ao projeto por padrão),
   `BRIDGE_CHROME_PATH` (Chrome completo fora da detecção Windows) e
   `ENVIO_SO_PARA` (somente testes).
   O token comercial pode ser o token do Hermes com escopo de preparação;
   não use o token restrito do enviador para preparar respostas.
6. Inicie a ponte pelo mecanismo existente. Rode os processos locais:

   ```powershell
   py .\envio\comercial-loop.py
   py .\envio\mktech_envio.py rodar --transporte whatsappweb
   ```

   Rode em processos separados, ou use `envio/iniciar-tudo.bat`, que agora inclui
   o worker V4. O V4 ativo suspende preparação/secretário legados. Ao mudar para
   V4, filas antigas ainda não enviadas são canceladas com histórico preservado;
   a troca é recusada durante um envio em andamento.
7. Regiões, nichos e pesquisa continuam em Configurações e nos loops existentes.

Para repetir a validação:

```powershell
npm test
npm run test:bridge
npm run typecheck
npm run build
npm run check:secrets
npm run test:db:windows
```

O último comando exige Postgres local em `127.0.0.1:54329`, usuário `postgres`,
e recria **somente** `crm_test`. O executável padrão é
`C:\Program Files\PostgreSQL\18\bin`; personalize com `MKTECH_TEST_PG_BIN`.
Os guardas rejeitam host remoto, porta diferente e banco fora do prefixo de teste.
O cluster utilizado nesta execução fica em `%TEMP%\mktech-hermes-v4-pg`.

## 16. Ativar e pausar

No painel V4, configure motor, canal, telefones controlados, vídeo e estratégias.
Mantenha modo de teste e a restrição da ponte. Cadastre apenas preços/condições
oficiais e marque os contatos elegíveis com o motivo correspondente. Aguarde
conexões recentes do Hermes, enviador e WhatsApp. **Ativar teste controlado** libera
um novo contato no dia; ativação inicial de produção limita a até cinco.

Horários, dias e meta ficam em Envio automático; cidades/nichos em Configurações.
**Pausar operação** para a reserva de novos envios em ambos os modos. Pausa não
retroage sobre transmissão já iniciada. **Assumir conversa** suspende só aquele
atendimento. **Devolver** permite retomar uma pergunta ainda não respondida,
respeitando exceções, limites e contexto atualizado.

Desmarcar **Usar motor V4** volta ao modo legado; isso não é o botão de pausa.
Use a pausa geral para parar mensagens. `envio/parar-tudo.bat` encerra também o
novo worker. Não apague o journal para resolver uma incerteza de envio.

## 17. Primeiro experimento recomendado

Primeiro valide um contato controlado: recepção, encaminhamento, preço aprovado,
consentimento e vídeo, recusa, pausa, tomada manual e desconexão. Confira o próprio
WhatsApp e os registros, inclusive entrega e ausência de duplicidade. Somente após
essa evidência e verificação de permissões, configure a operação real.

O experimento inicial usa trinta contatos elegíveis: dez A, dez B e dez C,
balanceados por cidade e faixa de score, em dias/horários comparáveis. Acompanhe
resposta humana, decisor, apresentação, interesse, proposta e fechamento. Trinta
contatos são exploração inicial; não constituem evidência suficiente para
declarar uma estratégia vencedora. A operação não muda automaticamente a partir
desse resultado.
