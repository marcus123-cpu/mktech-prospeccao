const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncHistory } = require('./history');

test('imports both directions with original dates, ignores groups and system events, isolates chat failures', async () => {
  const events = [];
  const message = { id: { _serialized: 'wa-1' }, type: 'chat', timestamp: 1700000000, body: 'Antiga', fromMe: false };
  const chat = { id: { _serialized: '5517999999999@c.us' }, fetchMessages: async ({ limit }) => {
    assert.equal(limit, 300);
    return [message, { ...message, id: { _serialized: 'wa-2' }, fromMe: true }, { ...message, type: 'protocol' }];
  } };
  const result = await syncHistory({ getChats: async () => [
    { isGroup: true }, { ...chat, fetchMessages: async () => { throw Error('offline'); } }, chat,
  ] }, { push: (kind, payload) => events.push({ kind, ...payload }) }, async () => '5517999999999', id => !!id, new Set(['protocol']));
  assert.equal(result.errors.length, 1);
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.kind === 'historico'));
  assert.deepEqual(events.map(e => e.direcao), ['entrada', 'saida']);
  assert.equal(events[0].ocorrida_em, '2023-11-14T22:13:20.000Z');
});
