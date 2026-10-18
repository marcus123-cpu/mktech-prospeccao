const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Journal } = require('./journal');
function file() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hermes-journal-')),'journal.json'); }

test('audio recovery is prioritized below live receipts and above bulk text history',()=>{
 const j=new Journal(file());j.push('historico',{message_id:'text'});j.push('historico',{message_id:'voice',audio_arquivo:'abc.bin'});j.push('historico',{message_id:'seen',live_receipt:true,ack:3});
 assert.deepEqual(j.list('historico').map(e=>e.message_id),['seen','voice','text']);
});

test('a queued history event gains recovered audio without duplicating its message',()=>{
 const j=new Journal(file());j.push('historico',{message_id:'voice',tipo:'audio'});
 j.push('historico',{message_id:'voice',tipo:'audio',audio_arquivo:'abc.bin',audio_mime:'audio/ogg'});
 const recovered=new Journal(j.file).list('historico');assert.equal(recovered.length,1);assert.equal(recovered[0].audio_arquivo,'abc.bin');
});

test('confirmações não se perdem quando entrega e leitura chegam antes do ack', () => {
  const j = new Journal(file());
  j.push('historico', { message_id: 'old' });
  j.push('historico', { message_id: 'wa', ack: 2, live_receipt: true });
  j.push('historico', { message_id: 'wa', ack: 3, live_receipt: true });
  j.push('historico', { message_id: 'wa', ack: 3, live_receipt: true });
  assert.deepEqual(j.list('historico').map(e => e.ack), [2, 3, undefined]);
  j.ack([j.list('historico')[0].event_id]);
  assert.equal(new Journal(j.file).list('historico')[0].ack, 3);
});

test('gravação tolera bloqueio transitório de arquivo no Windows', () => {
  const target = file();
  const journal = new Journal(target);
  const rename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    if (calls++ === 0) { const error = new Error('temporarily locked'); error.code = 'EPERM'; throw error; }
    return rename(...args);
  };
  try { journal.push('historico', {message_id:'durable-history'}); }
  finally { fs.renameSync = rename; }
  assert.equal(new Journal(target).list('historico').length, 1);
  assert.equal(calls, 2);
});

test('ack do histórico não apaga uma mensagem recebida ao vivo com o mesmo ID', () => {
  const j = new Journal(file());
  j.push('recebidas', {message_id:'same-id'});
  j.push('historico', {message_id:'same-id'});
  j.ack([j.list('historico')[0].event_id]);
  assert.equal(j.list('historico').length, 0);
  assert.equal(j.list('recebidas').length, 1);
});
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
