# WhatsApp oficial (Cloud API): passos na Meta

A API oficial só deixa começar uma conversa com um **modelo (template) aprovado**.
Por isso a saudação e o texto do Hermes vão juntos como variáveis de um modelo.

## O que fazer na Meta (uma vez)
1. Criar/entrar na conta **Meta Business** (business.facebook.com) e verificar a empresa (MKTech Dev).
2. Em **developers.facebook.com** criar um app do tipo *Business* e adicionar o produto **WhatsApp**.
3. Cadastrar o **número separado de prospecção** (ele não pode estar ativo no app do WhatsApp comum). Anote o **Phone number ID**.
4. Criar um **token permanente**: Usuário do sistema em Business Settings, com permissão `whatsapp_business_messaging` e `whatsapp_business_management`. Anote o token (não compartilhe no chat).
5. Em **WhatsApp Manager > Modelos de mensagem**, criar o modelo:
   - Nome: `mktech_primeiro_contato`
   - Categoria: **Marketing**; idioma: **Português (BR)**
   - Corpo: `MKTech Dev. {{1}} {{2}} Se não quiser receber mais mensagens, responda PARAR.`
   - Exemplos: `{{1}}` = `Bom dia, Clínica! Tudo bem?` e `{{2}}` = um texto curto de exemplo.
   - Aguardar a aprovação (costuma sair em minutos ou horas).
6. Para o teste, adicionar **17992250729** como número de destino permitido (no modo de teste/desenvolvimento).

## No PC (ou onde o enviador roda)
Preencher `envio/.env` com `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` e manter `ENVIO_SO_PARA=5517992250729` durante o teste.
Rodar: `py mktech_envio.py rodar --transporte whatsapp`.

## Observações
- O cliente só pode receber texto livre nossa depois de responder (janela de 24 h); o sistema não responde de qualquer forma.
- Receber as respostas na API oficial exige um *webhook* (endereço do painel que a Meta chama). Ainda não está feito: próximo passo.
- Custo: a Meta cobra por conversa iniciada pela empresa (categoria Marketing).
