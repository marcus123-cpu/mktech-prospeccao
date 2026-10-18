const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncHistory } = require('./history');

test('imports both directions with original dates, ignores groups and system events, isolates chat failures', async () => {
  const events = [];
  const message = { id: { _serialized: 'wa-1' }, type: 'chat', timestamp: 1700000000, body: 'Antiga', fromMe: false };
  const chat = { id: { _serialized: '5517999999999@c.us' }, fetchMessages: async ({ limit }) => {
    assert.equal(limit, 300);
    return [message, { ...message, id: { _serialized: 'wa-2' }, fromMe: true, ack: 3 }, { ...message, type: 'protocol' }];
  } };
  const result = await syncHistory({ getChats: async () => [
    { isGroup: true }, { ...chat, fetchMessages: async () => { throw Error('offline'); } }, chat,
  ] }, { push: (kind, payload) => events.push({ kind, ...payload }) }, async () => '5517999999999', id => !!id, new Set(['protocol']));
  assert.equal(result.errors.length, 1);
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.kind === 'historico'));
  assert.deepEqual(events.map(e => e.direcao), ['entrada', 'saida']);
  assert.equal(events[0].ocorrida_em, '2023-11-14T22:13:20.000Z');
  assert.equal(events[0].ack, undefined);
  assert.equal(events[1].ack, 3);
});

test('historical voice files are downloaded and remain attached to the history event', async () => {
  const events=[];
  const msg={id:{_serialized:'voice-old'},type:'ptt',timestamp:1700000000,fromMe:false,hasMedia:true};
  const chat={id:{_serialized:'5511999999999@c.us'},fetchMessages:async()=>[msg]};
  const result=await syncHistory({getChats:async()=>[chat]},{push:(_,p)=>events.push(p)},async()=>'5511999999999',()=>true,new Set(),300,async(m,id)=>{assert.equal(m,msg);assert.equal(id,'voice-old');return {audio_arquivo:'abc.bin',audio_mime:'audio/ogg'};});
  assert.equal(result.imported,1);assert.equal(events[0].audio_arquivo,'abc.bin');assert.equal(events[0].tipo,'audio');
});
