# Funil unificado — 13/10/2026

A tela Funil consultava apenas `outreach_messages`; as mensagens do motor V4
ficam em `commercial_outbox`. Isso ocultava contatos novos enfileirados e envios
confirmados, embora as fichas e o histórico estivessem no CRM.

A migração `20261013184000_funil_v4.sql` mantém a projeção antiga e reúne os
registros V4 com um cartão por lead. A fila, envio confirmado, resposta automática,
conversa humana, proposta, recusa, arquivo e falha têm classificação explícita.
Histórico cancelado não vira fila. Recusas e arquivos continuam visíveis mesmo
quando a proteção de envio cancela uma mensagem pendente. Uma resposta automática
posterior não apaga a última resposta humana na projeção V4.

O funil atualiza automaticamente a cada oito segundos quando a aba está visível.
O nome do contato abre seu histórico na central de conversas. Atendimentos
encerrados agora possuem coluna própria. O aviso de resposta pendente considera
se o contato escreveu depois da última saída registrada, evitando chamar de
pendente uma conversa já respondida pelo V4.

Validação: 15 cenários de banco do funil V4; 77 regressões de envio e secretário;
TypeScript e build. Os cenários verificam fila, envio, entrega, resultado
desconhecido, falha, duplicidade entre motores, cancelamento, arquivo/restauração,
recusa, resposta humana/automática e acesso restrito ao administrador.

Nenhum contato foi reenviado, nenhum registro foi apagado e os controles de
horário, meta e envio permaneceram com a configuração do operador.
