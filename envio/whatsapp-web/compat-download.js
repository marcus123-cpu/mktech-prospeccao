const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function patchDownloadSource(source,version){
 if(version!=='1.34.7')throw Error('Revisar download de mídia nesta versão');
 if(source.includes('// MKTech current message collection lookup'))return source;
 const start=source.indexOf("            const msg =\n                window.require('WAWebCollections').Msg.get(msgId) ||",source.indexOf('async downloadMedia()'));
 const end=source.indexOf('            // REUPLOADING mediaStage',start);
 if(start<0||end<0)throw Error('Estrutura do download mudou');
 const replacement=`            // MKTech current message collection lookup
            const store = window.require('WAWebCollections').Msg;
            let msg = store.get(msgId);
            if (!msg && typeof store.getModelsArray === 'function') {
                msg = store.getModelsArray().find(item => (item.id?._serialized || item.id?.$1) === msgId);
            }
            if (!msg) {
                try { msg = (await store.getMessagesById([msgId]))?.messages?.[0]; }
                catch (_) { return null; }
            }

`;
 const patched=source.slice(0,start)+replacement+source.slice(end);
 new vm.Script(patched);return patched;
}
function ensureDownloadCompatibility(){
 const pkg=require.resolve('whatsapp-web.js/package.json'),version=JSON.parse(fs.readFileSync(pkg,'utf8')).version;
 const file=path.join(path.dirname(pkg),'src/structures/Message.js');
 const source=fs.readFileSync(file,'utf8'),patched=patchDownloadSource(source,version);
 if(patched!==source)fs.writeFileSync(file,patched);
}
module.exports={patchDownloadSource,ensureDownloadCompatibility};
