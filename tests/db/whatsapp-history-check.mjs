// Transactional integration check against the isolated local test database only.
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const db = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'crm_test' });
await db.connect();
try {
  await db.query('begin');
  await db.query(readFileSync(new URL('../../supabase/migrations/20261016162241_historico_conversas_whatsapp.sql', import.meta.url), 'utf8'));
  const { rows: [lead] } = await db.query(`insert into leads(business_name,city,origin,phone_raw)
    values('Histórico de teste','Teste',(enum_range(null::lead_origin))[1],'+5517998764321') returning id,stage`);
  const message = { telefone: '+5517998764321', message_id: 'history-integration-test', direcao: 'entrada', texto: 'Mensagem antiga', tipo: 'texto', ocorrida_em: '2026-01-01T12:00:00Z' };
  await db.query('set local role service_role');
  const save = async value => (await db.query('select api_conversation_history($1::jsonb) as result', [JSON.stringify(value)])).rows[0].result;
  assert.equal((await save(message)).status, 'registrada');
  assert.equal((await save(message)).status, 'existente');
  assert.equal((await save({ ...message, telefone: '+5511998764321' })).status, 'ignorada');
  await db.query('reset role');
  assert.equal((await db.query('select count(*)::int as n from conversation_timeline where lead_id=$1',[lead.id])).rows[0].n,1);
  assert.equal((await db.query('select last_in_body from conversation_inbox where id=$1',[lead.id])).rows[0].last_in_body,message.texto);
  assert.equal((await db.query('select stage from leads where id=$1',[lead.id])).rows[0].stage,lead.stage);
  assert.equal((await db.query('select count(*)::int as n from outreach_replies where lead_id=$1',[lead.id])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from commercial_outbox where lead_id=$1',[lead.id])).rows[0].n,0);
  await db.query('set local role authenticated');
  assert.equal((await db.query('select count(*)::int as n from whatsapp_history where lead_id=$1',[lead.id])).rows[0].n,0);
  console.log('OK: migration, original message, idempotency, inbox, no automation, RLS');
} finally {
  await db.query('rollback');
  await db.end();
}
