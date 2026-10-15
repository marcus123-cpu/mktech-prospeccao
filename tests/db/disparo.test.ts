import { beforeEach, describe, expect, it } from 'vitest';
import { asAdmin, asService, candidate, createToken, pool, register, resetData, rpc } from './helpers';
import { greetingDecision } from '@/lib/commercial/v6/decision';

// Disparo simples: escolher leads, "só a saudação" ou "bot conversa sozinho", disparar.
let token: string; let lead: string;
const PHONE = '+5517991234567';
const svc = (sql: string, args: unknown[] = []) => asService(c => rpc<any>(c, sql, args));
const adm = (sql: string, args: unknown[] = []) => asAdmin(c => rpc<any>(c, sql, args));
const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;
const contexts = () => svc('select api_commercial_v6_contexts($1)', [token]);
const next = () => svc('select api_outreach_next($1)', [token]);
const result = (id: string) => svc('select api_commercial_result($1,$2,$3,$4,$5)', [token, id, 'enviada', 'wa-' + id, null]);
const start = (leads: string[] | null, over: { list?: string | null; all?: boolean; bot?: boolean; today?: number } = {}) =>
  adm('select admin_dispatch_start($1::uuid[],$2,$3,$4,$5,null)', [leads, over.list ?? null, over.all ?? false, over.bot ?? true, over.today ?? 20]);
const NOMES = ['Corpo Forte', 'Vida Ativa', 'Pulso Fit', 'Energia Total', 'Iron Box', 'Movimento Livre'];
let n = 0;
const mk = async (over: Record<string, unknown> = {}) => {
  const i = n++;
  return (await register(token, candidate({ business_name: `${NOMES[i % NOMES.length]} ${i}`, phone: `(17) 9${5000 + i}-${4000 + i}`, instagram: `@disp.${i}`, ...over }))).lead_id as string;
};
async function greet() {
  const ctx = (await contexts()).contexts[0];
  expect(ctx?.first_contact).toBe(true);
  expect(ctx.campaign_mode).toBe('autonomo');
  expect(ctx.recipient_timezone).toBeTruthy();
  const d = greetingDecision(ctx);
  expect(d.action).toBe('text'); // sem pesquisa completa, a campanha autoriza só a saudação simples
  return svc('select api_commercial_v6_save($1,$2,$3::jsonb)', [token, ctx.lease_id, JSON.stringify(d)]);
}
async function reply(body: string) {
  await svc('select api_outreach_reply($1,$2::jsonb)', [token, JSON.stringify({ phone_e164: PHONE, body, kind: 'humana', media: 'texto', reason: 'cliente', external_id: 'r-' + Math.random(), received_at: new Date(Date.now() - 10000).toISOString() })]);
}

describe('disparo simples', () => {
  beforeEach(async () => {
    await resetData(); n = 0; token = (await createToken()).id;
    lead = await mk({ phone: '(17) 99123-4567' });
    await pool.query("update commercial_settings set enabled=true,channel_authorized=true,engine_version='v6',test_mode=false; update outreach_settings set enabled=true,paused=false,window_start=0,window_end=24,reply_window_start=0,reply_window_end=24,min_fit_score=60,send_days=array[1,2,3,4,5,6,7],daily_limit=50");
  });

  it('um clique: cria campanha ativa e autônoma, sem simulação, e zera a nota mínima', async () => {
    const r = await start([lead], { today: 7 });
    expect(r).toMatchObject({ added: 1, rejected_total: 0 });
    expect((await q('select status,mode,bot_replies from commercial_campaigns'))[0]).toMatchObject({ status: 'ativa', mode: 'autonomo', bot_replies: true });
    expect((await q('select min_fit_score,today_new_leads_target,paused from outreach_settings'))[0]).toMatchObject({ min_fit_score: 0, today_new_leads_target: 7, paused: false });
  });

  it('só a saudação: sai de verdade, sem pesquisa completa, e a conversa passa para você', async () => {
    await start([lead], { bot: false });
    const g = await greet();
    expect((await q('select status from commercial_outbox where id=$1', [g.id]))[0].status).toBe('enfileirada');
    const out = await next();
    expect(out).toMatchObject({ status: 'enviar', telefone: PHONE });
    expect(out.texto).toMatch(/^Olá, (bom dia|boa tarde|boa noite)! Tudo bem\?$/);
    await result(out.id);
    expect((await q('select secretary_handoff_at from leads where id=$1', [lead]))[0].secretary_handoff_at).toBeTruthy();
    expect((await q("select count(*)::int n from commercial_campaign_log where event='conversa_com_voce'"))[0].n).toBe(1);
    await reply('Oi, tudo bem?');
    expect((await contexts()).contexts).toHaveLength(0); // o bot não responde: é com você
  });

  it('bot conversa sozinho: depois da saudação o Hermes continua atendendo as respostas', async () => {
    await start([lead], { bot: true });
    await greet();
    const out = await next();
    await result(out.id);
    expect((await q('select secretary_handoff_at from leads where id=$1', [lead]))[0].secretary_handoff_at).toBeNull();
    await reply('Oi, tudo bem?');
    await pool.query("update outreach_replies set received_at=now()-interval '10 seconds'");
    expect((await contexts()).contexts).toHaveLength(1);
  });

  it('lead de outro estado recebe saudação no fuso dele', async () => {
    const manaus = await mk({ state: 'AM', city: 'Manaus', phone: '(92) 99123-4567' });
    await start([manaus]);
    const ctx = (await contexts()).contexts[0];
    expect(ctx.recipient_timezone).toBe('America/Manaus');
  });

  it('o limite de hoje que você digita vale: com 1, só um novo contato sai', async () => {
    const second = await mk();
    await start([lead, second], { today: 1 });
    await greet();
    await greet();
    const first = await next();
    expect(first.status).toBe('enviar');
    await result(first.id);
    expect((await next()).status).not.toBe('enviar');
  });

  it('escolhas por lista e por todos os disponíveis; fixo, contatado e bloqueado ficam de fora', async () => {
    const a = await mk(), b = await mk();
    const fixo = await mk({ phone: '(14) 3222-1000' });
    const feito = await mk(); await pool.query('update leads set contacted=true where id=$1', [feito]);
    const bloq = await mk(); await pool.query('update leads set do_not_contact=true where id=$1', [bloq]);
    expect(await adm('select admin_dispatch_available_count()')).toBe(3); // lead, a, b
    const list = await adm('select admin_list_create($1)', ['Minha lista']);
    await adm('select admin_list_add($1,$2::uuid[])', [list, [a, fixo]]);
    const byList = await start(null, { list });
    expect(byList).toMatchObject({ added: 1, rejected_total: 1 });
    const all = await start(null, { all: true });
    expect(all.added).toBe(2); // lead e b; "a" já está em disparo
    await expect(start([fixo])).rejects.toThrow(/Nenhum lead pôde/);
  });

  it('avisos claros: Hermes desligado, envio desligado, quantidade inválida, nada escolhido', async () => {
    await pool.query('update commercial_settings set enabled=false');
    await expect(start([lead])).rejects.toThrow(/desligado/);
    await pool.query('update commercial_settings set enabled=true');
    await pool.query('update outreach_settings set enabled=false');
    await expect(start([lead])).rejects.toThrow(/chave de envio/);
    await pool.query('update outreach_settings set enabled=true');
    await expect(start([lead], { today: 0 })).rejects.toThrow(/1 a 200/);
    await expect(start([])).rejects.toThrow(/Nenhum lead escolhido/);
  });

  it('pausar o disparo segura a fila; pedido de não contato nunca é contornado', async () => {
    await start([lead]);
    await greet();
    const camp = (await q('select id from commercial_campaigns'))[0].id;
    await adm('select admin_campaign_action($1,$2)', [camp, 'pause']);
    expect((await next()).status).toBe('fila_vazia');
    await adm('select admin_campaign_action($1,$2)', [camp, 'resume']);
    await pool.query('update leads set do_not_contact=true where id=$1', [lead]);
    expect((await next()).status).not.toBe('enviar');
  });
});
