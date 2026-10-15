# Hermes autônomo — campanhas, simulação e pausa

14/10/2026 · migração `supabase/migrations/20261014160000_campanhas_autonomas.sql` · painel **Campanhas** (`/campanhas`)

## O que mudou
Não existe aprovação individual de mensagens: o administrador escolhe os leads, liga a
campanha e o Hermes (motor V6) conduz saudação, respostas, objeções, preço e demonstrações
sozinho. O que o administrador controla: quais leads entram, ativar/pausar/encerrar,
serviços/preços (produtos aprovados), limites, horários e retornos (Configurações e Central
de disparos, que continuam valendo).

## Como funciona
- **Seleção manual:** só lead de uma campanha **ativa** recebe primeiro contato (motor V6). A
  fila automática da pesquisa diária deixa de disparar sozinha. Ao adicionar, o banco recusa
  lead com pedido de não contato, sem telefone, já contatado, em outra campanha, com telefone
  duplicado ou sem pesquisa suficiente (mesmos critérios da fila V6). Cada recusa vem com o motivo.
- **Simulação (padrão):** o Hermes pesquisa, escreve a saudação e conversa, mas nada vai para a
  fila real. As mensagens ficam como `simulada`, aparecem na campanha e no registro; “Responder
  como cliente” injeta respostas fictícias (preço, recusa, interesse, pedido de humano). Recusa
  ou encaminhamento simulados **não** bloqueiam nem alteram o lead real.
- **Autônomo:** só é liberado depois de uma simulação com saudação e ao menos uma resposta
  contextual. Liberar apaga as conversas simuladas e restaura o lead ao estado original.
  Ativar exige motor V6, Hermes ligado e canal confirmado. Há confirmação explícita no botão.
- **Pausa imediata:** “Pausar” (campanha) e “Pausar tudo agora” (todas as campanhas + envio global).
  Mensagens já na fila ficam retidas; decisões em andamento são recusadas (`campanha_inativa`).
  Encerrar cancela a fila da campanha. Retomar libera de onde parou.
- **Regras que a autonomia não contorna:** não contatar (regra de texto e decisão do modelo),
  bloqueio administrativo, telefone inválido/duplicado, limites diários, horários, limite de
  mensagens por conversa, janela de envio e `new_contacts_enabled`. Pedido de não contato real
  grava `do_not_contact` e um evento `bloqueio_registrado` na campanha.
- **Intervenção humana:** preço sem produto aprovado, pedido do responsável, desconto,
  reclamação ou contexto incerto geram encaminhamento/aviso (`intervencao_humana`, `aviso_equipe`).
- **Logs:** `commercial_campaign_log` (ações, decisões, respostas simuladas, bloqueios), além de
  `commercial_decisions`, `commercial_outbox` e `commercial_events`.
- **Reinício:** todo o estado está no banco. Lease expirado volta à fila; chave de idempotência
  `lead:resposta:revisão` impede segunda mensagem para a mesma decisão.

## Como usar
1. Aplique a migração e atualize painel, worker e ponte juntos.
2. `/campanhas` → crie a campanha → selecione os leads → **Ativar simulação**.
3. Aguarde a saudação, responda como cliente em vários cenários e revise o registro.
4. **Pausar** → **Liberar modo autônomo** → **Ativar em modo autônomo**.

## Testes (`tests/db/campaigns.test.ts`, 16 casos)
Lead fora de campanha não sai; seleção manual e recusas; ativação sem lead/sem V6; simulação sem
envio real; recusa simulada sem bloquear o lead; liberação do autônomo só após simulação e com
restauração; autônomo sem aprovação individual e sem duplicar; reinício com lease expirado; pausa
(retém e retoma); decisão em voo após pausa; pausa geral; encerrar; pedido de não contato real;
preço; pedido do responsável; permissão só do administrador. Nenhum teste envia mensagem real.

## Limites conhecidos
- Mensagens simuladas usam as tabelas reais (`simulated=true`) e podem aparecer em contagens do
  painel até a simulação ser liberada/apagada.
- Preço/desconto: o Hermes só cita produtos aprovados; sem eles, encaminha.
- Cinco testes de banco já falhavam antes (quatro por mensagem de erro em português do Postgres
  local e um por expectativa desatualizada de encaminhamento de preço); não foram alterados.
