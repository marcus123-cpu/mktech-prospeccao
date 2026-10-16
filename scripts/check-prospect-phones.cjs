// Consulta existência do número na sessão conectada; não envia mensagens.
const fs=require('node:fs');
const puppeteer=require('../envio/whatsapp-web/node_modules/puppeteer');
(async()=>{
 const phones=process.argv.slice(2);
 if(!phones.length||phones.length>10||phones.some(p=>!/^55\d{10,11}$/.test(p)))throw Error('Informe até dez números comerciais brasileiros');
 const port=fs.readFileSync('envio/whatsapp-web/.wwebjs_auth/session-chip2/DevToolsActivePort','utf8').split(/\r?\n/)[0];
 const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+port});
 try{
  const page=(await browser.pages()).find(p=>p.url().startsWith('https://web.whatsapp.com/'));
  if(!page)throw Error('WhatsApp indisponível');
  for(const phone of phones){
   const registered=await page.evaluate(async phone=>{
    const wid=window.require('WAWebWidFactory').createWid(phone+'@c.us');
    const result=await window.require('WAWebQueryExistsJob').queryWidExists(wid);
    return !!result?.wid;
   },phone);
   console.log(JSON.stringify({phone,registered,checked_at:new Date().toISOString()}));
  }
 }finally{browser.disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
