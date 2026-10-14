# Agentes separados: pesquisa e atendimento

Em 14/10/2026, o agente de pesquisa passou a ser invocado pelo Codex CLI na
rotina agendada `MKTech Prospeccao` e nos pedidos da tela de pesquisas. Ele lê a
skill `hermes/skills/mktech-prospeccao/SKILL.md`, consulta o CRM, pesquisa fontes
e registra candidatos e diagnósticos. Não usa comandos de mensagens nem acessa
diretamente o WhatsApp. O cadastro continua sujeito à deduplicação e às regras
de prontidão do CRM.
O executor Codex usa `workspace-write` com rede liberada; um selftest de leitura
do CRM e uma busca web foram verificados nessa configuração.

O agente de atendimento V6 pode usar a OpenRouter. Cada conversa recebe apenas
o contexto daquele lead, incluindo diagnóstico, evidências e histórico. O modelo
propõe uma decisão em JSON; o servidor valida fontes, consentimento, recusa,
preço, demonstrações e duplicidade antes de enfileirar qualquer mensagem. Até
três conversas podem ser interpretadas em paralelo para uma falha lenta não
bloquear as outras. O transporte e o catálogo de demonstrações permanecem os
mesmos.

Para ativar, adicione as linhas abaixo a `envio/.env`, que é ignorado pelo Git:

```
MKTECH_COMMERCIAL_PROVIDER=openrouter
OPENROUTER_API_KEY=<chave privada>
MKTECH_COMMERCIAL_MODEL=openai/gpt-6-luna
```

Reinicie somente `envio/comercial-loop.bat` depois de configurar. A chave não
deve ser colocada no painel, no repositório ou no chat. Antes da ativação, faça
um teste isolado de inferência, confirme o JSON e acompanhe uma resposta real
em um número autorizado. A pesquisa continua independente da chave OpenRouter.

Enquanto a chave não estiver configurada e validada, `new_contacts_enabled`
ficou desligado em produção para não abrir novas conversas que o atendente
atual pode deixar sem resposta. O secretário, as conversas já iniciadas e a
pesquisa permanecem ligados. A fila de saudações é preservada. Depois do
teste real, retome novas abordagens pela Central de disparos.

Diagnóstico da falha observada: várias respostas chegaram ao CRM em 14/10/2026,
mas os respectivos leads acumularam `inference_failures` e notificações
`Interpretação V6 indisponível`. O processamento sequencial agravava o atraso.
Não há evidência de perda das mensagens recebidas.
