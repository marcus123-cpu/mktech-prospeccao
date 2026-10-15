import { describe, expect, it } from 'vitest';
import { additionSchema, dayNumber, mergePlaybook, parsePlaybook, SECTIONS } from '@/lib/aprendizado';

describe('aprendizado.md', () => {
  it('cria todas as seções e acrescenta regras sem repetir', () => {
    const a = { section: SECTIONS[0], rule: 'Abre só com bom dia, sem apresentar a empresa.', example: 'Bom dia! Tudo bem?' };
    const first = mergePlaybook('', [a]);
    expect(first.added).toBe(1);
    for (const s of SECTIONS) expect(first.markdown).toContain(`## ${s}`);
    const again = mergePlaybook(first.markdown, [a, { ...a, rule: 'ABRE só com bom dia, sem apresentar a empresa!' }]);
    expect(again.added).toBe(0);
    expect(parsePlaybook(again.markdown).get(SECTIONS[0])).toHaveLength(1);
  });

  it('mantém regras antigas e passa de 30 por seção descartando a mais velha', () => {
    let md = '';
    for (let i = 0; i < 32; i++) md = mergePlaybook(md, [{ section: SECTIONS[2], rule: `Regra numero ${i} diferente de todas as outras` }]).markdown;
    const rules = parsePlaybook(md).get(SECTIONS[2])!;
    expect(rules).toHaveLength(30);
    expect(rules[0]).toContain('numero 2 ');
    expect(rules[29]).toContain('numero 31');
  });

  it('valida seção e tamanho das regras', () => {
    expect(additionSchema.safeParse({ section: 'Outra', rule: 'Uma regra qualquer aqui' }).success).toBe(false);
    expect(additionSchema.safeParse({ section: SECTIONS[1], rule: 'curta' }).success).toBe(false);
  });

  it('conta o dia do aprendizado a partir do dia 1', () => {
    expect(dayNumber(null, '2026-10-20')).toBe(0);
    expect(dayNumber('2026-10-16', '2026-10-16')).toBe(1);
    expect(dayNumber('2026-10-16', '2026-11-14')).toBe(30);
  });
});
