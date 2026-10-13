const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Journal } = require('./journal');
function file() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hermes-journal-')),'journal.json'); }
test('entrada sobrevive reinício e só sai depois de ack', () => {
  const f=file(); let j=new Journal(f); j.push('recebidas',{message_id:'msg-1',texto:'Pode mandar'});
  j=new Journal(f); assert.equal(j.list('recebidas').length,1);
  j.push('recebidas',{message_id:'msg-1',texto:'Pode mandar'}); assert.equal(j.list('recebidas').length,1);
  j.ack(['msg-1']); assert.equal(new Journal(f).list('recebidas').length,0);
});
test('reserva desconhecida não recomeça envio após reinício',()=>{
  const f=file();let j=new Journal(f);assert.equal(j.begin('item-1','payload-1'),null);
  j=new Journal(f); assert.equal(j.begin('item-1','payload-1').status,'desconhecido');
  assert.throws(()=>j.begin('item-1','payload-2'),/conteúdo diferente/);
});
test('envio e entrega são eventos separados com confirmação persistente',()=>{
  const f=file();const j=new Journal(f);j.begin('item-1','payload-1');j.result('item-1','enviada','wa-id');
  j.ackResult('item-1','enviada');assert.equal(j.pendingResults().length,0);
  j.result('item-1','entregue','wa-id');assert.equal(j.pendingResults()[0].status,'entregue');
  assert.equal(new Journal(f).begin('item-1','payload-1').provider_id,'wa-id');
});
test('ack antigo não apaga confirmação de entrega posterior',()=>{
  const j=new Journal(file());j.begin('item-1','payload-1');j.result('item-1','entregue','wa-id');j.ackResult('item-1','enviada');assert.equal(j.pendingResults().length,1);
});
