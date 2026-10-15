import { beforeEach, describe, expect, it } from 'vitest';
import { asAdmin, asService, pool, resetData, rpc } from './helpers';

const adm = (sql: string, args: unknown[] = []) => asAdmin(c => rpc<any>(c, sql, args));
const svc = (sql: string, args: unknown[] = []) => asService(c => rpc<any>(c, sql, args));

describe('aprendizados do Hermes', () => {
  beforeEach(async () => { await resetData(); await pool.query('truncate hermes_learnings'); });

  it('o Hermes propõe, só o aprovado entra no prompt', async () => {
    expect(await svc('select api_learning_propose($1)', ['Responda curto quando a pessoa só perguntar o preço.'])).toBe(true);
    expect(await svc('select api_learnings_active()')).toEqual([]);
    const l = await adm('select row_to_json(x) from admin_learnings_list() x');
    expect(l).toMatchObject({ status: 'pendente', source: 'hermes' });
    await adm('select admin_learning_set($1,$2)', [l.id, 'ativa']);
    expect(await svc('select api_learnings_active()')).toEqual(['Responda curto quando a pessoa só perguntar o preço.']);
    await adm('select admin_learning_set($1,$2)', [l.id, 'recusada']);
    expect(await svc('select api_learnings_active()')).toEqual([]);
  });

  it('ignora repetida, texto curto e você pode ensinar direto (máx. 20 ativos)', async () => {
    await svc('select api_learning_propose($1)', ['Pergunte antes de falar de valores.']);
    expect(await svc('select api_learning_propose($1)', ['pergunte antes de falar de valores.'])).toBe(false);
    expect(await svc('select api_learning_propose($1)', ['curta'])).toBe(false);
    await adm('select admin_learning_add($1)', ['Use no máximo duas frases na primeira apresentação.']);
    expect(await svc('select api_learnings_active()')).toHaveLength(1);
    for (let i = 0; i < 19; i++) await adm('select admin_learning_add($1)', [`Lição manual número ${i} para teste.`]);
    await expect(adm('select admin_learning_add($1)', ['Mais uma lição acima do limite permitido.'])).rejects.toThrow(/No máximo 20/);
  });
});
