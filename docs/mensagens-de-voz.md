# Enviar arquivo como mensagem de voz

Em **Conversas**, abra o contato e use **Enviar mensagem de voz**, abaixo do
campo de texto. Selecione um arquivo, escute a prévia e clique em **Enviar como
mensagem de voz**. O contato precisa ter telefone e não pode estar bloqueado.

Formatos: MP3, M4A, OGG, WAV, WebM e AAC; limite de 3 MB e 10 minutos.
A ponte converte para OGG/Opus mono e envia com `sendAudioAsVoice: true`.
O PC, a ponte e o enviador precisam estar ligados e o WhatsApp conectado.
O envio é uma decisão manual, assume a conversa e usa a fila manual existente.
O áudio aparece no histórico com player e estado de envio.

Arquivos ficam no bucket privado `chat-audio`. Links para leitura expiram.
O enviador recebe um link curto para baixar o original e entrega os bytes à
ponte local, que usa FFmpeg/FFprobe. Configure `BRIDGE_FFMPEG_PATH` em `envio/.env`
se os executáveis não estiverem no PATH. Mantenha FFprobe ao lado de FFmpeg.

Migrações necessárias, nesta ordem: `20261016200000_audio_e_resposta_manual.sql`
e `20261016200001_envio_mensagem_voz.sql`. Atualize painel, ponte e enviador juntos.
Reservas duráveis impedem reenviar o mesmo item após falha de confirmação.
Se o envio falhar, confira o WhatsApp antes de enviar novamente pelo painel.

Validação: `node tests/db/voice-check.mjs` (transação revertida no banco local),
`node --test envio/whatsapp-web/voice.test.cjs`, `python -m unittest discover -s
envio/tests -p test_voice.py`, e `npx vitest run tests/api/voice-upload.test.ts`.
