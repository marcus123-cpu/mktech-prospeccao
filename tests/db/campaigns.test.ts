import { beforeEach, describe, expect, it } from 'vitest';
import { asAdmin, asService, candidate, createToken, pool, register, resetData, rpc } from './helpers';
import { contextualDecision, greetingDecision } from '@/lib/commercial/v6/decision';

// Campanhas do Hermes autônomo: seleção manual, simulação sem envio real,
// modo autônomo sem aprovação individual, pausa, bloqueio e reinício.
let token: string; let lead: string; let camp: string;
const PHONE = '+5517991234567';
const svc = (sql: string, args: unknown[] = []) => asService(c => rpc<any>(c, sql, args));
const adm = (sql: string, args: unknown[] = []) => asAdmin(c => rpc<any>(c, sql, args));
const contexts = () => svc('select api_commercial_v6_contexts($1)', [token]);
const next = () => svc('select api_outreach_next($1)', [token]);
const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;
const forcedGreeting = (ctx: any) => ({ ...greetingDecision(ctx), intent: 'greeting_v6', action: 'text', body: 'Olá, bom dia! Tudo bem?', phase: 'GREETING_PENDING', readiness: { status: 'READY_FOR_OUTREACH', reasons: [] } });
const saveDecision = (ctx: any, d: any) => svc('select api_commercial_v6_save($1,$2,$3::jsonb)', [token, ctx.lease_id, JSON.stringify(d)]);
async function newCampaign() {
  camp = await adm('select admin_campaign_create($1,$2)', ['Campanha teste', 'notas']);
  await adm('select admin_campaign_add_leads($1,$2::uuid[])', [camp, [lead]]);
}
async function reply(body: string, external_id = 'r-' + Math.random()) {
  return svc('select api_outreach_reply($1,$2::jsonb)', [token, JSON.stringify({ phone_e164: PHONE, body, kind: 'humana', media: 'texto', reason: 'cliente', external_id, received_at: new Date(Date.now() - 10000).toISOString() })]);
}
function proposal(ctx: any, over: any) {
  return { interpretations: ctx.pending_messages.map((m: any) => ({ message_id: m.id, type: 'human', confidence: .99, intentions: [{ kind: 'BUSINESS_QUESTION', confidence: .99, evidence: m.body }] })),
    action: 'respond', response: 'Sou o assistente comercial da MKTech Dev, empresa de sites e sistemas.', reason: 'Responder', phase: 'WAITING_CHANNEL_CONFIRMATION', role: 'UNKNOWN', role_evidence: '',
    solution: null, opportunity_index: null, demonstration_id: null, product_id: null, confirmed_facts: [], uncertain_facts: [], answered_questions: [], objections: [],
    summary: 'Resumo', next_action: 'Seguir', followup_at: null, followup_evidence: '', source_ids: [], ...over };
}
// Executa a saudação (primeiro contato) para o lead da campanha ativa.
async function greet() {
  const ctx = (await contexts()).contexts[0];
  expect(ctx?.first_contact).toBe(true);
  const r = await saveDecision(ctx, forcedGreeting(ctx));
  expect(r.status).toBe('registrado');
  return r;
}
async function respondTo(text: string, over: any) {
  await reply(text);
  await pool.query("update outreach_replies set received_at=now()-interval '10 seconds'");
  const ctx = (await contexts()).contexts[0];
  expect(ctx).toBeTruthy();
  const d = contextualDecision(ctx, proposal(ctx, typeof over === 'function' ? over(ctx) : over) as any, 'mock-test');
  expect(d.validation_errors).toEqual([]);
  return { ctx, saved: await saveDecision(ctx, d) };
}

describe('Hermes autônomo: campanhas', () => {
  beforeEach(async () => {
    await resetData(); token = (await createToken()).id;
    lead = (await register(token, candidate())).lead_id;
    await asAdmin(c => c.query('select admin_commercial_lead($1,$2::jsonb)', [lead, JSON.stringify({ eligible: true, eligibility_reason: 'pesquisa completa' })]));
    await pool.query("update commercial_settings set enabled=true,channel_authorized=true,engine_version='v6',test_mode=false; update outreach_settings set enabled=true,paused=false,window_start=0,window_end=24,reply_window_start=0,reply_window_end=24,min_fit_score=0,send_days=array[1,2,3,4,5,6,7],daily_limit=50,today_new_leads_target=50,today_new_leads_date=(now() at time zone 'America/Sao_Paulo')::date");
  });

  it('lead fora de campanha não recebe primeiro contato nem envio', async () => {
    expect((await contexts()).contexts).toHaveLength(0);
    await pool.query("insert into commercial_outbox(lead_id,idempotency_key,kind,body,phone_e164) values($1,'legado','initial','Olá! Tudo bem?',$2)", [lead, PHONE]);
    expect((await next()).status).toBe('fila_vazia');
    expect((await q('select status from commercial_outbox'))[0].status).toBe('cancelada');
  });

  it('seleção manual autoriza lead com pesquisa fraca, mas rejeita bloqueados, duplicados, contatados e telefone fixo', async () => {
    const dup = (await register(token, candidate({ business_name: 'Outra Clínica', phone: '(17) 98888-1111', instagram: '@outra' }))).lead_id;
    const weak = (await register(token, candidate({ business_name: 'Clínica Fraca', phone: '(17) 97777-2222', instagram: '@fraca' }))).lead_id;
    const fixo = (await register(token, candidate({ business_name: 'Clínica Fixo', phone: '(14) 3222-1000', instagram: '@fixo' }))).lead_id;
    const blocked = (await register(token, candidate({ business_name: 'Clínica Bloqueada', phone: '(17) 96666-3333', instagram: '@bloq' }))).lead_id;
    const done = (await register(token, candidate({ business_name: 'Clínica Contatada', phone: '(17) 95555-4444', instagram: '@cont' }))).lead_id;
    for (const id of [dup, blocked, done]) await asAdmin(c => c.query('select admin_commercial_lead($1,$2::jsonb)', [id, JSON.stringify({ eligible: true, eligibility_reason: 'pesquisa completa' })]));
    await pool.query('update leads set do_not_contact=true where id=$1', [blocked]);
    await pool.query('update leads set contacted=true where id=$1', [done]);
    camp = await adm('select admin_campaign_create($1,$2)', ['Seleção', null]);
    const r = await adm('select admin_campaign_add_leads($1,$2::uuid[])', [camp, [lead, dup, weak, fixo, blocked, done, lead]]);
    expect(r.added).toBe(3);
    expect((await pool.query('select eligible from commercial_leads where lead_id=$1', [weak])).rows[0].eligible).toBe(true);
    const why = Object.fromEntries(r.rejected.map((x: any) => [x.lead_id, x.reason]));
    expect(why[weak]).toBeUndefined();
    expect(why[fixo]).toMatch(/fixo/);
    expect(why[blocked]).toMatch(/não ser contatado/);
    expect(why[done]).toMatch(/já foi contatado/);
    // Mesmo lead em segunda campanha ou telefone repetido é recusado.
    const second = await adm('select admin_campaign_create($1,$2)', ['Outra', null]);
    expect((await adm('select admin_campaign_add_leads($1,$2::uuid[])', [second, [lead]])).rejected[0].reason).toMatch(/já pertence/);
    await pool.query("update leads set phone_raw='(17) 99123-4567' where id=$1", [dup]);
    await adm('select admin_campaign_remove_lead($1)', [dup]);
    expect((await adm('select admin_campaign_add_leads($1,$2::uuid[])', [second, [dup]])).rejected[0].reason).toMatch(/duplicado/);
  });

  it('campanha em rascunho ou sem motor V6 não ativa; sem leads também não', async () => {
    camp = await adm('select admin_campaign_create($1,$2)', ['Vazia', null]);
    await expect(adm('select admin_campaign_action($1,$2)', [camp, 'activate'])).rejects.toThrow(/ao menos um lead/);
    await newCampaign();
    await pool.query("update commercial_settings set engine_version='v4'");
    await expect(adm('select admin_campaign_action($1,$2)', [camp, 'activate'])).rejects.toThrow(/V6/);
  });

  it('simulação: saudação e conversa são registradas sem envio real nem alteração do lead', async () => {
    await newCampaign();
    expect((await contexts()).contexts).toHaveLength(0); // rascunho não opera
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const g = await greet();
    expect((await q('select status,simulated,sent_at is not null as sent from commercial_outbox where id=$1', [g.id]))[0]).toMatchObject({ status: 'simulada', simulated: true, sent: true });
    expect((await next()).status).toBe('fila_vazia');
    expect((await q('select contacted,stage from leads where id=$1', [lead]))[0]).toMatchObject({ contacted: false, stage: 'novo' });
    await adm('select admin_campaign_simulate_reply($1,$2)', [lead, 'Quem é você?']);
    await pool.query("update outreach_replies set received_at=now()-interval '10 seconds'");
    const ctx = (await contexts()).contexts[0];
    expect(ctx.campaign_mode).toBe('simulacao');
    expect(ctx.messages.some((m: any) => m.source === 'simulacao')).toBe(true);
    const d = contextualDecision(ctx, proposal(ctx, {}) as any, 'mock-test');
    expect(d.validation_errors).toEqual([]);
    const saved = await saveDecision(ctx, d);
    expect(saved.status).toBe('registrado');
    expect((await q("select status from commercial_outbox where id=$1", [saved.id]))[0].status).toBe('simulada');
    expect((await next()).status).toBe('fila_vazia');
    const events = (await q('select event from commercial_campaign_log where campaign_id=$1', [camp])).map((x: any) => x.event);
    expect(events).toEqual(expect.arrayContaining(['lead_adicionado', 'acao_activate', 'decisao_simulada', 'resposta_simulada']));
  });

  it('simulação de recusa registra bloqueio simulado sem bloquear o lead real', async () => {
    await newCampaign(); await adm('select admin_campaign_action($1,$2)', [camp, 'activate']); await greet();
    await adm('select admin_campaign_simulate_reply($1,$2)', [lead, 'Não quero receber mensagens']);
    await pool.query("update outreach_replies set received_at=now()-interval '10 seconds'");
    const ctx = (await contexts()).contexts[0];
    const p = proposal(ctx, { action: 'stop', response: null, phase: 'CLOSED', interpretations: ctx.pending_messages.map((m: any) => ({ message_id: m.id, type: 'human', confidence: .99, intentions: [{ kind: 'OPT_OUT', confidence: .99, evidence: m.body }] })) });
    const d = contextualDecision(ctx, p as any, 'mock-test');
    expect(d.validation_errors).toEqual([]);
    expect((await saveDecision(ctx, d)).status).toBe('registrado');
    expect((await q('select do_not_contact from leads where id=$1', [lead]))[0].do_not_contact).toBe(false);
    expect((await q("select count(*)::int n from commercial_campaign_log where event='bloqueio_simulado'"))[0].n).toBe(1);
    expect((await contexts()).contexts).toHaveLength(0);
  });

  it('modo autônomo só é liberado após simulação e restaura o lead ao estado original', async () => {
    await newCampaign();
    await expect(adm('select admin_campaign_set_mode($1,$2)', [camp, 'autonomo'])).rejects.toThrow(/simulação/);
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    await greet();
    await expect(adm('select admin_campaign_set_mode($1,$2)', [camp, 'autonomo'])).rejects.toThrow(/Pause/);
    await adm('select admin_campaign_simulate_reply($1,$2)', [lead, 'Quem é você?']);
    await pool.query("update outreach_replies set received_at=now()-interval '10 seconds'");
    const ctx = (await contexts()).contexts[0];
    await saveDecision(ctx, contextualDecision(ctx, proposal(ctx, {}) as any, 'mock-test'));
    await adm('select admin_campaign_action($1,$2)', [camp, 'pause']);
    await adm('select admin_campaign_set_mode($1,$2)', [camp, 'autonomo']);
    expect((await q('select count(*)::int n from commercial_outbox'))[0].n).toBe(0);
    expect((await q('select count(*)::int n from outreach_replies'))[0].n).toBe(0);
    expect((await q('select conversation_phase,processed_reply from commercial_leads where lead_id=$1', [lead]))[0]).toMatchObject({ conversation_phase: 'NEEDS_RESEARCH', processed_reply: null });
    expect((await q('select count(*)::int n from lead_conversation_memory'))[0].n).toBe(0);
    await adm('select admin_campaign_action($1,$2)', [camp, 'resume']);
    expect((await contexts()).contexts[0].first_contact).toBe(true);
  });

  it('autônomo: envia sem aprovação individual, responde contextualmente e não duplica', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx0 = (await contexts()).contexts[0];
    const g = await saveDecision(ctx0, forcedGreeting(ctx0));
    expect((await saveDecision(ctx0, forcedGreeting(ctx0))).status).toBe('desatualizada');
    expect((await q("select status from commercial_outbox where id=$1", [g.id]))[0].status).toBe('enfileirada');
    const out = await next();
    expect(out).toMatchObject({ status: 'enviar', telefone: PHONE });
    expect(out.texto).toMatch(/^Olá, (bom dia|boa tarde|boa noite)! Tudo bem\?$/);
    expect((await next()).status).toBe('aguardar');
    await svc('select api_commercial_result($1,$2,$3,$4,$5)', [token, out.id, 'enviada', 'wa-1', null]);
    expect((await q('select contacted from leads where id=$1', [lead]))[0].contacted).toBe(true);
    const { saved } = await respondTo('Quem é você?', {});
    expect((await q('select status from commercial_outbox where id=$1', [saved.id]))[0].status).toBe('enfileirada');
    expect((await next()).texto).toMatch(/assistente comercial da MKTech Dev/);
    expect((await q('select count(*)::int n from commercial_outbox'))[0].n).toBe(2);
  });

  it('reinício: lease expirado reaparece, mas a mesma decisão não gera segunda mensagem', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    await pool.query("update commercial_leads set lease_until=now()-interval '1 minute'");
    expect((await saveDecision(ctx, forcedGreeting(ctx))).status).toBe('desatualizada');
    const again = (await contexts()).contexts[0];
    expect(again.lead_id).toBe(ctx.lead_id);
    expect((await saveDecision(again, forcedGreeting(again))).status).toBe('registrado');
    expect((await q('select count(*)::int n from commercial_outbox'))[0].n).toBe(1);
    expect((await contexts()).contexts).toHaveLength(0);
  });

  it('pausa imediata retém a fila e impede novas decisões; retomar libera', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    const g = await saveDecision(ctx, forcedGreeting(ctx));
    await adm('select admin_campaign_action($1,$2)', [camp, 'pause']);
    expect((await next()).status).toBe('fila_vazia');
    expect((await q('select status from commercial_outbox where id=$1', [g.id]))[0].status).toBe('enfileirada');
    expect((await contexts()).contexts).toHaveLength(0);
    await pool.query("update commercial_outbox set due_at=now()-interval '1 second'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'resume']);
    expect((await next()).status).toBe('enviar');
  });

  it('decisão em andamento é recusada se a campanha for pausada antes de gravar', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    await adm('select admin_campaign_action($1,$2)', [camp, 'pause']);
    expect((await saveDecision(ctx, forcedGreeting(ctx))).status).toBe('campanha_inativa');
    expect((await q('select count(*)::int n from commercial_outbox'))[0].n).toBe(0);
  });

  it('pausa geral pausa todas as campanhas e o envio global', async () => {
    await newCampaign(); await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    expect(await adm('select admin_campaign_pause_all()')).toBe(1);
    expect((await q('select status from commercial_campaigns'))[0].status).toBe('pausada');
    expect((await q('select paused from outreach_settings'))[0].paused).toBe(true);
    expect((await contexts()).contexts).toHaveLength(0);
  });

  it('encerrar cancela mensagens na fila e nada mais é processado', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    const g = await saveDecision(ctx, forcedGreeting(ctx));
    await adm('select admin_campaign_action($1,$2)', [camp, 'end']);
    expect((await q('select status from commercial_outbox where id=$1', [g.id]))[0].status).toBe('cancelada');
    expect((await next()).status).toBe('fila_vazia');
    await expect(adm('select admin_campaign_action($1,$2)', [camp, 'resume'])).rejects.toThrow(/indisponível/);
  });

  it('pedido de não contato interrompe imediatamente e registra o bloqueio na campanha', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    await saveDecision(ctx, forcedGreeting(ctx));
    const out = await next();
    await svc('select api_commercial_result($1,$2,$3,$4,$5)', [token, out.id, 'enviada', 'wa-1', null]);
    await reply('Não quero receber mais mensagens, por favor');
    await pool.query("update outreach_replies set received_at=now()-interval '10 seconds'");
    const r = await q('select do_not_contact from leads where id=$1', [lead]);
    if (!r[0].do_not_contact) { // bloqueio semântico: decisão de parada do modelo
      const c2 = (await contexts()).contexts[0];
      const p = proposal(c2, { action: 'stop', response: null, phase: 'CLOSED', interpretations: c2.pending_messages.map((m: any) => ({ message_id: m.id, type: 'human', confidence: .99, intentions: [{ kind: 'OPT_OUT', confidence: .99, evidence: m.body }] })) });
      expect((await saveDecision(c2, contextualDecision(c2, p as any, 'mock-test'))).status).toBe('registrado');
    }
    expect((await q('select do_not_contact from leads where id=$1', [lead]))[0].do_not_contact).toBe(true);
    expect((await q("select count(*)::int n from commercial_campaign_log where event='bloqueio_registrado'"))[0].n).toBeGreaterThan(0);
    expect((await contexts()).contexts).toHaveLength(0);
    expect((await next()).status).not.toBe('enviar');
  });

  it('cliente que pede preço recebe resposta e a equipe é avisada, sem aprovação individual', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    await saveDecision(ctx, forcedGreeting(ctx));
    const out = await next();
    await svc('select api_commercial_result($1,$2,$3,$4,$5)', [token, out.id, 'enviada', 'wa-1', null]);
    await pool.query("update commercial_leads set commercial_memory=jsonb_set(commercial_memory,'{introduced}','true')");
    const { saved } = await respondTo('Quanto custa?', (c: any) => ({
      action: 'handoff', response: 'Vou encaminhar seu pedido à equipe responsável para confirmar o orçamento.', reason: 'Não há produto e preço aprovados', phase: 'HUMAN_HANDOFF',
      interpretations: c.pending_messages.map((m: any) => ({ message_id: m.id, type: 'human', confidence: .99, intentions: [{ kind: 'PRICE_QUESTION', confidence: .99, evidence: m.body }] })),
    }));
    expect(saved.status).toBe('registrado');
    expect((await q('select status from commercial_outbox where id=$1', [saved.id]))[0].status).toBe('enfileirada');
    expect((await q("select count(*)::int n from commercial_notifications where title like 'Equipe deve confirmar%'"))[0].n).toBe(1);
  });

  it('cliente que pede o responsável gera intervenção humana registrada na campanha', async () => {
    await newCampaign(); await pool.query("update commercial_campaigns set mode='autonomo'");
    await adm('select admin_campaign_action($1,$2)', [camp, 'activate']);
    const ctx = (await contexts()).contexts[0];
    await saveDecision(ctx, forcedGreeting(ctx));
    const out = await next();
    await svc('select api_commercial_result($1,$2,$3,$4,$5)', [token, out.id, 'enviada', 'wa-1', null]);
    await pool.query("update commercial_leads set commercial_memory=jsonb_set(commercial_memory,'{introduced}','true')");
    const { saved } = await respondTo('Quero falar com o responsável', (c: any) => ({
      action: 'handoff', response: 'Certo, vou avisar a equipe responsável para falar com você.', reason: 'Cliente pediu o responsável', phase: 'HUMAN_HANDOFF',
      interpretations: c.pending_messages.map((m: any) => ({ message_id: m.id, type: 'human', confidence: .99, intentions: [{ kind: 'UNKNOWN', confidence: .99, evidence: m.body }] })),
    }));
    expect(saved.status).toBe('registrado');
    const sent = await next();
    await svc('select api_commercial_result($1,$2,$3,$4,$5)', [token, sent.id, 'enviada', 'wa-2', null]);
    expect((await q('select secretary_handoff_at from leads where id=$1', [lead]))[0].secretary_handoff_at).toBeTruthy();
    expect((await q("select count(*)::int n from commercial_campaign_log where event='intervencao_humana'"))[0].n).toBe(1);
  });

  it('somente o administrador autenticado controla campanhas', async () => {
    await expect(svc('select admin_campaign_pause_all()')).rejects.toThrow();
    await expect(svc('select admin_campaign_create($1,$2)', ['x', null])).rejects.toThrow();
  });
});
