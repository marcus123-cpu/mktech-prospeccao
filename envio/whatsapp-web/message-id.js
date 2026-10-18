// WA Web pode serializar MsgKey com _serialized ou $1. O ID deve ser estável
// tanto no retorno do envio como nos eventos de recebimento/entrega.
function messageId(message){
 const id=message && message.id;
 if(typeof id==='string')return id;
 if(!id)return null;
 const canonical=id._serialized || id.$1;
 if(typeof canonical==='string'&&canonical.length<=200)return canonical;
 const remote=typeof id.remote==='string' ? id.remote : id.remote?._serialized;
 if(typeof id.fromMe==='boolean'&&typeof remote==='string'&&typeof id.id==='string')return `${id.fromMe}_${remote}_${id.id}`;
 return null;
}
function prepareMediaMessage(message) {
 const id=messageId(message);
 if(!id)return null;
 // The pinned downloadMedia still reads the old Node-side property.
 message.id={...(typeof message.id==='object'?message.id:{}),_serialized:id};
 return id;
}
module.exports={messageId,prepareMediaMessage};
