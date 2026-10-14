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

Em 14/10/2026, a triagem automática passou a admitir uma resposta curta quando
o bot do negócio pergunta nome, assunto, como pode ajudar ou com quem desejamos falar. Hermes se
identifica como Hermes, da MKTech Dev, pede a responsável e explica o motivo
geral do contato. O CRM permite apenas uma resposta a automação por lead; uma
mensagem de ausência sem pergunta continua em espera. A primeira pessoa que
responder recebe apresentação comercial normal, pois pode não ter lido a
triagem anterior. Demonstração, preço e consentimento continuam bloqueados
nessa etapa automática.

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
### Objeção inicial sem interesse

Em Comercial → Configuração da operação, **Uma apresentação breve após “não tenho interesse”** controla a resposta V6 à primeira recusa comercial. Ligada por padrão, ela permite uma única mensagem curta que reconhece a recusa, explica uma oportunidade sustentada pelo diagnóstico e pede permissão para mostrar um exemplo existente e explicar seu funcionamento sem compromisso. A resposta não envia vídeo nem link; o catálogo só é usado depois de autorização específica. O lead fica aguardando a pessoa, sem retorno automático por essa objeção. Uma segunda recusa encerra a conversa. Pedidos explícitos para parar ou remover o número continuam bloqueando o contato imediatamente. Leads já bloqueados antes desta regra permanecem bloqueados.
