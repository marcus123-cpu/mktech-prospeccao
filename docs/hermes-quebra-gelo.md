# Abertura comercial — correção de 13/10/2026

O V4 estava oferecendo a solução ou demonstração no primeiro envio, antes da
saudação e da investigação. A primeira abordagem agora é apenas “Olá, bom dia /
boa tarde / boa noite! Tudo bem?”, calculada no horário de São Paulo no momento
de reservar o envio. A mesma mensagem fica registrada no histórico.

Depois da resposta humana, o motor agradece, diz o primeiro nome, cita um serviço
real presente nas fontes e pergunta como chegam os novos clientes. Nenhuma
solução ou demonstração é oferecida nesse passo. Quando a pessoa responde, os
canais que ela declarou orientam a apresentação da ideia e o pedido de permissão.
Datas de pesquisa não são usadas para alegar atividade recente. Serviços sem
evidência não aparecem na mensagem.

Perguntas diretas, recusas, controle manual e pedidos explícitos de material têm
precedência sobre o roteiro. Não se presume consentimento para enviar o vídeo
ou o link. Respostas automáticas não liberam o próximo passo. Uma resposta sem
contexto suficiente é encaminhada para interpretação humana.

A migração `20261013181000_quebra_gelo_v4.sql` corrige somente primeiras mensagens
ainda enfileiradas, limpa a associação indevida ao material e preserva mensagens
já enviadas. Quatro mensagens da reposição foram corrigidas. A abordagem já
enviada ao Espaço Terapêutico Soul foi preservada e não será repetida.

Validação: 214 testes de unidade/API; 205 testes de banco validados entre a suíte
completa e as novas verificações dos fluxos alterados; TypeScript e build local.
Os testes incluem manhã/tarde/noite, espera de resposta humana, fonte verificável,
resposta contextual, pergunta de preço, recusa, autorização de material, sequência
completa até o vídeo e migração de fila sem alterar mensagens já enviadas.

Os controles de envio do operador foram preservados: o envio estava desligado
no painel durante a correção. Não foram enviados testes a novos destinatários.
