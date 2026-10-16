# Histórico na reconexão

Atualize painel, ponte e enviador juntos. Aplique a migração
`supabase/migrations/20261016162241_historico_conversas_whatsapp.sql` no Supabase
antes de reiniciar a ponte e o enviador.

Ao conectar, a ponte busca até 300 mensagens disponíveis por conversa individual.
Somente telefones já cadastrados em leads são importados no CRM. Grupos, status
e eventos de sistema são ignorados. Textos e datas originais são preservados;
áudio e imagem aparecem pelo tipo, sem download do arquivo. Não há garantia de
recuperar mensagens que o WhatsApp não disponibiliza para o aparelho conectado.

O histórico usa uma fila durável separada. O enviador confirma cada item somente
após o CRM aceitar a gravação. Repetir a conexão não duplica IDs já importados.
Mensagens já registradas ao vivo prevalecem na linha do tempo. Importação não
altera etapas nem insere respostas nas tabelas que acionam automação.

Com o enviador rodando, os itens chegam em lotes de até 20 a cada 30 segundos. A aba
Conversas atualiza automaticamente enquanto está visível. A ponte expõe o progresso em
`GET /historico/estado`, com o mesmo token dos demais endpoints protegidos.
Falhas em uma conversa não interrompem as demais; uma nova conexão repete a busca.

A ponte aplica uma correção de compatibilidade para os IDs do WhatsApp Web
na biblioteca 1.34.7 antes de iniciá-la. A gravação do histórico também repete
operações bloqueadas temporariamente pelo Windows. A primeira carga de mensagens
do aparelho pode demorar; o navegador interno aguarda até dez minutos por operação.
