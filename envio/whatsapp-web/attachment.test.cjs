const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deliverAttachment}=require('./attachment');
const {Journal}=require('./journal');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('attachments use the manual journal and never resend a reserved item',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attachment-test-'));
 try {
 const journal=new Journal(path.join(dir,'journal.json'));const calls=[];
 const client={getNumberId:async()=>({_serialized:'5511999999999@c.us'}),sendMessage:async(...args)=>{calls.push(args);return {id:{_serialized:'file-provider'}};}};
 class Media {constructor(mime,data,filename){Object.assign(this,{mime,data,filename});}}
 const item={client,journal,itemId:'11111111-1111-4111-8111-111111111111',digits:'5511999999999',data:Buffer.from('%PDF-test').toString('base64'),mime:'application/pdf',filename:'proposta.pdf',MessageMedia:Media};
 assert.equal((await deliverAttachment(item)).ok,true);assert.equal((await deliverAttachment(item)).id,'file-provider');
 assert.equal(calls.length,1);assert.equal(calls[0][2].sendMediaAsDocument,true);
 assert.equal(journal.pendingResults().length,0);
 await assert.rejects(deliverAttachment({...item,filename:'different.pdf'}),/conteúdo diferente/);
 await assert.rejects(deliverAttachment({...item,mime:'application/x-msdownload'}),/não aceito/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
