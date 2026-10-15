import { beforeEach, describe, expect, it } from 'vitest';
import { asAdmin, asService, pool, resetData, rpc } from './helpers';

const svc = (sql: string, args: unknown[] = []) => asService(c => rpc<any>(c, sql, args));
const adm = (sql: string, args: unknown[] = []) => asAdmin(c => rpc<any>(c, sql, args));
const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;

describe('aprendizado do Hermes (30 dias)', () => {
  beforeEach(async () => {
    await resetData();
    await pool.query("truncate hermes_apprenticeship_days; update hermes_apprenticeship set status='nao_iniciado',started_on=null,study_requested_at=null,playbook='',final_report=null");
  });

  it('só inicia uma vez e conta o dia 1 como hoje', async () => {
    await adm('select admin_apprenticeship_start()');
    const g = await adm('select admin_apprenticeship_get()');
    expect(g).toMatchObject({ day_number: 1, total_days: 30, program: { status: 'aprendendo' } });
    await expect(adm('select admin_apprenticeship_start()')).rejects.toThrow(/já foi iniciado/);
  });

  it('o estudante lê o dia, grava nota e playbook; o dia 30 conclui o estudo', async () => {
    await adm('select admin_apprenticeship_start()');
    const st = await svc('select api_apprenticeship_state()');
    expect(st).toMatchObject({ status: 'aprendendo', saved_days: [], study_requested: false });
    const today = st.today as string;
    const data = await svc('select api_apprenticeship_day_data($1::date)', [today]);
    expect(data).toMatchObject({ day: today, conversations: [] });
    await adm('select admin_apprenticeship_request_study()');
    expect((await svc('select api_apprenticeship_state()')).study_requested).toBe(true);
    await svc('select api_apprenticeship_save_day($1::date,$2)', [today, 'Hoje aprendi como ele abre a conversa.']);
    await svc('select api_apprenticeship_save_playbook($1)', ['# aprendizado.md']);
    const after = await svc('select api_apprenticeship_state()');
    expect(after).toMatchObject({ study_requested: false, playbook: '# aprendizado.md', saved_days: [today] });
    expect((await q('select stats from hermes_apprenticeship_days'))[0].stats).toMatchObject({ leads: 0, seus_audios: 0 });
    // dia 30
    await pool.query("update hermes_apprenticeship set started_on = (now() at time zone 'America/Sao_Paulo')::date - 29");
    await svc('select api_apprenticeship_save_day(((now() at time zone $1)::date), $2)', ['America/Sao_Paulo', 'Último dia']);
    expect((await q('select status from hermes_apprenticeship'))[0].status).toBe('concluido');
  });

  it('as conversas do dia chegam com quem falou: você, cliente e robô', async () => {
    await adm('select admin_apprenticeship_start()');
    const lead = (await q("insert into leads(business_name,city,phone_raw,phone_e164,instagram_raw,instagram_handle,niche,state,source_name,research_date,selection_reason,origin) values('Clínica X','Bauru','(14) 99111-2222','+5514991112222','@x','x','estetica','SP','t',current_date,'t','hermes') returning id"))[0].id;
    await pool.query("insert into outreach_replies(lead_id,phone_e164,body,received_at,kind) values($1,'+5514991112222','Obrigada pelo contato! Como podemos ajudar?',now(),'automatica')", [lead]);
    const today = (await svc('select api_apprenticeship_state()')).today;
    const data = await svc('select api_apprenticeship_day_data($1::date)', [today]);
    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0].events[0]).toMatchObject({ who: 'resposta automática' });
    expect(data.stats).toMatchObject({ leads: 1, respostas_automaticas: 1 });
  });

  it('etapas: concluído → teste → aprovado; saltos são recusados', async () => {
    await pool.query("update hermes_apprenticeship set status='aprendendo'");
    await expect(adm('select admin_apprenticeship_set_status($1)', ['aprovado'])).rejects.toThrow(/não permitida/);
    await pool.query("update hermes_apprenticeship set status='concluido'");
    await adm('select admin_apprenticeship_set_status($1)', ['teste']);
    await adm('select admin_apprenticeship_set_status($1)', ['aprovado']);
    expect((await q('select status from hermes_apprenticeship'))[0].status).toBe('aprovado');
  });
});
