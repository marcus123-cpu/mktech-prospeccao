const { createHash } = require('node:crypto');
const { messageId } = require('./message-id');
const MAX = 30 * 1024 * 1024;
async function deliverAttachment({client,journal,itemId,digits,data,mime,filename,caption,MessageMedia,onSending=()=>()=>{},onSent=()=>{}}) {
  if (!/^[0-9a-f-]{36}$/i.test(itemId || '') || !/^[1-9]\d{7,14}$/.test(digits || '')) throw Error('Dados inválidos');
  if (typeof data !== 'string' || data.length > Math.ceil(MAX/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error('Arquivo inválido');
  const bytes = Buffer.from(data,'base64');
  if (!bytes.length || bytes.length>MAX || typeof mime!=='string' || !/^(video\/(mp4|webm|quicktime)|image\/(jpeg|png|webp)|application\/(pdf|zip|vnd\.openxmlformats-officedocument\.[a-z.]+)|text\/(plain|csv))$/.test(mime)) throw Error('Arquivo não aceito');
  const name = String(filename || 'arquivo').replace(/[\\/\x00-\x1f]/g,'_').slice(0,180);
  const legenda=typeof caption==='string'?caption.trim().slice(0,1000):'';
  const fingerprint=createHash('sha256').update(digits+'|'+mime+'|'+name+(legenda?'|'+legenda:'')).update(bytes).digest('hex');
  const response = r => ({ok:['enviada','entregue'].includes(r.status),id:r.provider_id,message_status:r.status});
  const previous=journal.data.sends[itemId];
  if(previous){if(previous.fingerprint!==fingerprint)throw Error('Chave reutilizada com conteúdo diferente');return response(previous);}
  const destination=await client.getNumberId(digits);
  if(!destination)throw Error('Número não tem WhatsApp');
  const existing=journal.begin(itemId,fingerprint,'manual');
  if(existing)return response(existing);
  const finish=onSending(destination._serialized,digits);
  let sent;
  try {sent=await client.sendMessage(destination._serialized,new MessageMedia(mime,data,name),{sendMediaAsDocument:!mime.startsWith('image/')&&!mime.startsWith('video/'),...(legenda?{caption:legenda}:{})});}
  finally {if(finish)finish();}
  const id=messageId(sent);if(id)onSent(id);
  journal.result(itemId,id?'enviada':'desconhecido',id);
  return response(journal.data.sends[itemId]);
}
module.exports={deliverAttachment};
