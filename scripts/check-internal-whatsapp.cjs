// Inspeção somente leitura da sessão local; não envia mensagens.
const fs=require('node:fs');
const path=require('node:path');
const puppeteer=require('../envio/whatsapp-web/node_modules/puppeteer');
(async()=>{
 const port=fs.readFileSync(path.resolve('envio/whatsapp-web/.wwebjs_auth/session-chip2/DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
 const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+port});
 try{
  const page=(await browser.pages()).find(p=>p.url().startsWith('https://web.whatsapp.com/'));
  if(!page)throw new Error('Sessão local não encontrada');
  const materials=JSON.parse(fs.readFileSync('hermes/videos-demonstracao/catalogo.json','utf8')).materials;
  const caption=materials.find(d=>d.id==='DEMO_ROSANA_LANDING').caption;
  const polpuja=materials.find(d=>d.id==='DEMO_POLPUJA_VITRINE');
  const result=await page.evaluate(async ({caption,linkBody})=>{
   const resolved=await window.WWebJS.enforceLidAndPnRetrieval('5517992250729@c.us');
   const targets=[resolved.lid?._serialized,resolved.phone?._serialized].filter(Boolean);
   const models=window.require('WAWebCollections').Msg.getModelsArray();
   const items=models.filter(m=>m.id.fromMe && targets.includes(String(m.id.remote)) && (m.caption===caption||m.body===caption||m.body===linkBody)).map(m=>({id:String(m.id),type:m.type,timestamp:m.t,ack:m.ack,material:m.type==='video'?'DEMO_ROSANA_LANDING':'DEMO_POLPUJA_VITRINE'}));
   const WidFactory=window.require('WAWebWidFactory');
   const wid=WidFactory.createWid('5517992250729@c.us');
   const chat=window.require('WAWebCollections').Chat.get(wid);
   return {messages:items,loadedTestChat:!!chat,compatibility:{mediaModel:window.WWebJS.sendMessage.toString().includes('delete message.__x_id;'),messageKeyLookup:window.WWebJS.sendMessage.toString().includes('newMsgKey._serialized || newMsgKey.$1'),lookupConfirmed:models.filter(m=>items.some(i=>i.id===String(m.id))).every(m=>!!window.require('WAWebCollections').Msg.get(m.id._serialized||m.id.$1))}};
  },{caption,linkBody:polpuja.caption+'\n\n'+polpuja.url});
  if(process.argv.includes('--persist-link-receipt')){
   const link=result.messages.filter(m=>m.material==='DEMO_POLPUJA_VITRINE');
   if(link.length!==1||link[0].ack<2)throw new Error('Entrega do link ainda não verificada');
   fs.writeFileSync('backups/release-link-receipt.json',JSON.stringify(link[0]));
  }
  if(process.argv.includes('--persist-receipts')){
   if(result.messages.length!==2||result.messages.some(m=>m.ack<2))throw new Error('Entregas não confirmadas');
   fs.writeFileSync('backups/release-material-receipts.json',JSON.stringify(result.messages));
  }
  console.log(JSON.stringify({internal_test_history:result}));
 }finally{await browser.disconnect();}
})().catch(()=>{console.error('Não foi possível verificar o histórico local.');process.exitCode=1;});
