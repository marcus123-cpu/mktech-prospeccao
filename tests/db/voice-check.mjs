import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const db = new pg.Client({host:'127.0.0.1',port:54329,user:'postgres',database:'crm_test'});
await db.connect();
try {
  await db.query('begin');
  await db.query('create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint)');
  for (const name of ['20261016162241_historico_conversas_whatsapp.sql','20261016200000_audio_e_resposta_manual.sql','20261016200001_envio_mensagem_voz.sql']) {
    await db.query(readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
  }
  const user=(await db.query("insert into auth.users(email) values('voice-test@local.test') returning id")).rows[0].id;
  await db.query('insert into app_admins(user_id) values($1)',[user]);
  const lead=(await db.query("insert into leads(business_name,city,origin,phone_raw) values('Voz teste','Teste',(enum_range(null::lead_origin))[1],'+5517998764321') returning id")).rows[0].id;
  const item=(await db.query('select gen_random_uuid() as id')).rows[0].id;
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  await db.query('select admin_send_voice_reply($1,$2,$3,$4,$5)',[lead,item,`voice-outbox/${item}/original`,'audio/wav',1000]);
  const timeline=(await db.query('select * from conversation_timeline where lead_id=$1',[lead])).rows[0];
  assert.equal(timeline.media,'audio'); assert.equal(timeline.external_id,'voice:'+item);
  await db.query('set local role service_role');
  const next=(await db.query('select api_manual_next($1) as result',[user])).rows[0].result;
  assert.equal(next.media,'audio'); assert.equal(next.id,item); assert.equal(next.audio_mime,'audio/wav');
  assert.equal((await db.query('select api_manual_next($1) as result',[user])).rows[0].result.status,'aguardar');
  await db.query("select api_manual_result($1,$2,true,'voice-provider',null)",[user,item]);
  await db.query('reset role');
  assert.equal((await db.query('select status from manual_outbox where id=$1',[item])).rows[0].status,'enviada');
  assert.ok((await db.query('select secretary_handoff_at from leads where id=$1',[lead])).rows[0].secretary_handoff_at);
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub','',true)");
  assert.equal((await db.query('select count(*)::int as n from manual_outbox')).rows[0].n,0);
  console.log('OK: voice queue, admin access, PTT metadata, claim once, timeline player, handoff, RLS');
} finally { await db.query('rollback'); await db.end(); }
