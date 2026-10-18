const { messageId } = require('./message-id');

// Historical messages use a separate queue: they must never enter live reply automation.
async function syncHistory(client, journal, resolveNumber, isIndividual, systemTypes, limit = 300, saveAudio = async () => ({})) {
  let imported = 0;
  const errors = [];
  for (const chat of await client.getChats()) {
    if (chat.isGroup || !isIndividual(chat.id?._serialized)) continue;
    try {
      const messages = await chat.fetchMessages({ limit });
      if (!messages.length) continue;
      const number = await resolveNumber(chat.id._serialized, {
        getContact: () => chat.getContact(),
      });
      if (!number) continue;
      for (const msg of messages) {
        const id = messageId(msg);
        if (!id || msg.isStatus || systemTypes.has(msg.type) || !msg.timestamp) continue;
        journal.push('historico', {
          message_id: id, telefone: '+' + number.replace(/\D/g, ''),
          direcao: msg.fromMe ? 'saida' : 'entrada',
          texto: typeof msg.body === 'string' ? msg.body.slice(0, 4000) : null,
          tipo: msg.type === 'chat' ? 'texto' : ['audio', 'ptt'].includes(msg.type) ? 'audio' : msg.type === 'image' ? 'imagem' : 'outro',
          ocorrida_em: new Date(msg.timestamp * 1000).toISOString(),
          ...(['audio','ptt'].includes(msg.type) ? await saveAudio(msg,id) : {}),
          ...(msg.fromMe && Number.isInteger(msg.ack) ? { ack: msg.ack } : {}),
        });
        imported++;
      }
    } catch (error) { errors.push(String(error.message).slice(0, 160)); }
  }
  return { imported, errors };
}

module.exports = { syncHistory };
