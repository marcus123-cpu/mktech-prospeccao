# Envio pelo WhatsApp Web (chip novo de prospecção)

O enviador (`mktech_envio.py`) fala com uma **ponte local** (`envio/whatsapp-web/bridge.js`) que usa o
WhatsApp Web do chip de prospecção. A ponte só escuta em `127.0.0.1`, só envia o que o enviador pedir e
**nunca responde cliente**. O servidor do CRM continua decidindo tudo (chave global, pausa, horário, limite, espera).

Aviso: é um método não oficial; o WhatsApp pode banir o número. Por isso o chip é só para prospecção, no máximo
10 por dia, de manhã, com 3 a 5 minutos entre envios.

## O que fazer no PC (uma vez)
1. Instalar o **Node.js LTS** (nodejs.org) e o **Python 3** (já usado pelo Hermes).
2. Colocar o **chip novo** num celular, ativar o WhatsApp (pode ser o WhatsApp Business) e dar um nome/foto da MKTech Dev.
   Dica: use o número alguns dias antes (conversas normais) para esquentar.
3. Na pasta `envio/whatsapp-web`: `npm install`
4. Copiar `envio/.env.exemplo` para `envio/.env` e preencher `MKTECH_CRM_URL`, `MKTECH_ENVIO_TOKEN` (criado na tela
   Envio automático do painel) e `ENVIO_SO_PARA=5517992250729` (modo teste).
5. Abrir a ponte: `node bridge.js` (na pasta `envio/whatsapp-web`) e **escanear o QR code** com o WhatsApp do chip
   (Aparelhos conectados > Conectar um aparelho). A sessão fica salva em `.wwebjs_auth`.
6. Em outro terminal, na pasta `envio`: `py mktech_envio.py rodar --transporte whatsappweb`.

Mantenha o **gateway de WhatsApp do próprio Hermes desligado** nesse chip, para ele não responder clientes.

## Teste (antes de qualquer cliente)
Com `ENVIO_SO_PARA=5517992250729`, só esse número recebe. Ligue a chave na tela Envio, rode o teste, confira o texto
no celular de teste e **aprove por escrito** na thread. Só então esvazie `ENVIO_SO_PARA`.
