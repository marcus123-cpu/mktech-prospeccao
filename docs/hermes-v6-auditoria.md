# Auditoria anterior à refatoração V6 — 13/10/2026

Auditoria realizada no repositório existente antes de alterar o código do V6.
Base publicada: `b2cb4be`, incluindo as correções de abertura e do funil.

## Estrutura e componentes encontrados

1. **Aplicação:** Next.js 15 / React 19 em `src/app`, com páginas autenticadas
   em `src/app/(painel)` e APIs do Hermes em `src/app/api/hermes/v1`.
2. **Prospecção:** `hermes/skills/mktech-prospeccao/SKILL.md`, script
   `hermes/skills/mktech-prospeccao/scripts/mktech_crm.py`, rotinas de pedido em
   `envio/pedido-loop.bat` e endpoints `candidates`, `duplicates`, `runs`, `pedidos`.
   Identificadores e idempotência evitam recadastro; pesquisa não autoriza contato.
3. **WhatsApp:** `envio/whatsapp-web/bridge.js`, biblioteca whatsapp-web.js,
   sessão persistente local `session-chip2`; servidor somente em 127.0.0.1:3799.
4. **Recepção:** ponte grava entradas duráveis em `journal.js`; o enviador
   `envio/mktech_envio.py` encaminha para `envio/respostas/route.ts` e só confirma
   a fila local quando o CRM persiste o evento.
5. **Geração atual:** `envio/comercial-loop.py` chama `comercial/processar/route.ts`,
   que executa `src/lib/commercial/engine.ts`. O motor é determinístico, baseado
   em expressões regulares e respostas construídas; não faz inferência semântica.
   O secretário legado em `envio/secretario-loop.bat` usava a CLI Hermes.
6. **Prompts/regras:** skill de prospecção, `references/metodo-abordagem.md`, motor
   comercial e validadores em `src/lib/envio`. A antiga identidade “Me chamo Marcos”
   precisa ser substituída pela identidade de assistente comercial aprovada no V6.
7. **Diagnóstico:** `lead_diagnoses`, `lead_evidences` e RPC `lead_approach_context`.
   O endpoint de cadastro calcula nota verificável; confiança é separada da nota.
   Falta uma prontidão explícita capaz de impedir contato com diagnóstico insuficiente.
8. **Banco:** Supabase/Postgres existente. Tabelas principais `leads`,
   `commercial_leads`, `commercial_settings`, `commercial_decisions`,
   `commercial_events`, `commercial_outbox`, `commercial_notifications`,
   `commercial_products`, `outreach_replies`, `lead_conversation_memory`,
   `commercial_demonstrations` e `lead_demonstrations`. Migrações em `supabase/migrations`.
9. **Estado:** `commercial_leads.stage`, `role`, `facts`, `processed_reply`,
   `revision`, `followup_at`. A abertura restaurada usa `facts.abertura`.
   Falta estado explícito para espera de primeira resposta, canal incorreto e
   interpretação semântica com intenções múltiplas e confiança.
10. **Demonstrações:** catálogo real em `hermes/videos-demonstracao/catalogo.json`,
    vídeo Rosana relativo ao projeto e URL Polpujá. A ponte resolve ID aprovado,
    verifica arquivo/hash e registra resultados; o banco exige autorização contextual.
11. **CRM/histórico:** `conversation_timeline` reúne entradas, saídas manuais,
    secretário, lembretes e V4; decisões e eventos registram motivos e versões.
    Funil unificado publicado, verificado em navegador autenticado: os cinco
    contatos da reposição aparecem uma vez cada.
12. **Duplicatas/concorrência:** IDs externos únicos, versão do lead e última
    entrada humana, lock transacional `mktech-envio`, outbox reservada uma vez,
    ID/fingerprint persistente na ponte. Resultado ambíguo não é reenviado cegamente.
13. **Memória:** `lead_conversation_memory` armazena resumo, fatos, objeções e
    próxima ação; `commercial_leads.facts` é persistente. Falta atualização semântica
    estruturada de informações confirmadas/incertas, perguntas respondidas e solução.
14. **Controles:** chave geral, pausa, secretário, meta do dia, horários, elegibilidade,
    opt-out, handoff manual, allowlist de teste e máximo de mensagens. A pausa bloqueia
    envios; eventos recebidos continuam persistidos. O V6 será validado com produção pausada.

## Evidências do problema

O motor V4 originalmente oferecia a demonstração já no primeiro contato; isso foi
corrigido. Mesmo após a correção, a regra de investigação continuava baseada em
palavras-chave. O exemplo real de Camarim informou agenda online e pediu retorno,
mas foi registrado como humano pelo classificador legado. A nota alta também não
equivale a diagnóstico confiável: há contatos com fonte limitada e atividade não
confirmada, que precisam de um bloqueio de prontidão independente da elegibilidade.

## Runtime de IA disponível

A instalação local Hermes possui modelo e provedor configurados e autenticação
existente. A configuração inspecionada indica `gpt-6-sol` via `openai-codex`.
Nenhuma credencial foi impressa. O código local oferece `AIAgent.run_conversation`,
invocação one-shot e seleção de ferramentas. A nova interpretação deverá usar
esse runtime ou um adaptador configurável, sem permitir ferramentas ao modelo de
conversação, sem carregar memórias pessoais e sem colocar tokens no contexto.

## Direção da implementação

Preservar CRM, transporte e biblioteca. Separar prontidão, saudação com timezone
IANA, montagem do contexto por lead, classificação semântica estruturada, decisão,
geração, validação determinística, memória e análises agregadas. O modelo interpreta
e propõe; o servidor valida fontes, consentimento, preços, versões e envio. Falha de
IA ou de contexto deve resultar em espera/handoff, nunca em uma oferta improvisada.
Teste real será identificado como simulação e restrito ao número autorizado final 0729.
