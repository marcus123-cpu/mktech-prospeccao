// Correção upstream ainda ausente no pacote 1.34.7:
// https://github.com/wwebjs/whatsapp-web.js/pull/201923
// MsgKey mudou de _serialized para $1: https://github.com/wwebjs/whatsapp-web.js/issues/201857
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function patchSource(source,version) {
  let patched=source;
  const oldLookup='.Msg.get(newMsgKey._serialized);';
  const newLookup='.Msg.get(newMsgKey._serialized || newMsgKey.$1);';
  const needsMedia=!source.includes('delete message.__x_id;');
  const needsLookup=source.includes(oldLookup);
  if(!needsMedia&&!needsLookup)return source;
  if(version!=='1.34.7')throw new Error('Revisar compatibilidade de mídia para esta versão do WhatsApp Web');
  const marker="        // Bot's won't reply if canonicalUrl is set (linking)";
  if(needsMedia){
    if(source.split(marker).length!==2 || !source.includes('            ...mediaOptions,'))throw new Error('Estrutura da biblioteca mudou; correção não aplicada');
    patched=patched.replace(marker,'        // Upstream #201923: não copiar o ID interno do modelo de mídia.\n        delete message.__x_id;\n\n'+marker);
  }
  if(needsLookup){if(source.split(oldLookup).length!==2)throw new Error('Lookup de mensagem não reconhecido');patched=patched.replace(oldLookup,newLookup);}
  new vm.Script(patched);
  return patched;
}
function ensureMediaCompatibility(){
 const packagePath=require.resolve('whatsapp-web.js/package.json');
 const version=JSON.parse(fs.readFileSync(packagePath,'utf8')).version;
 const file=path.join(path.dirname(packagePath),'src/util/Injected/Utils.js');
 const original=fs.readFileSync(file,'utf8');const patched=patchSource(original,version);
 if(patched!==original)fs.writeFileSync(file,patched);
}
module.exports={ensureMediaCompatibility,patchSource};
