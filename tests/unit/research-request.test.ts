import { describe, expect, it } from 'vitest';
import { RESEARCH_DEFAULTS, researchSchema, locationLabel } from '@/lib/research';
import { registrationFocus } from '@/lib/commercial/research-focus';

describe('pedido de pesquisa', () => {
  it('padrões: Brasil inteiro e 100 leads', () => {
    expect(RESEARCH_DEFAULTS).toMatchObject({ scope: 'brasil', target: 100 });
    const r = researchSchema.parse({ niche: 'Academia', scope: 'brasil', target: '100', state: 'SP', city: 'Bauru' });
    expect(r).toMatchObject({ scope: 'brasil', target: 100, state: undefined, city: undefined });
  });
  it('nicho livre e obrigatório', () => {
    expect(researchSchema.safeParse({ niche: ' ', scope: 'brasil', target: 10 }).success).toBe(false);
    expect(researchSchema.parse({ niche: ' Oficina Mecânica ', scope: 'brasil', target: 10 }).niche).toBe('Oficina Mecânica');
  });
  it('estado e cidade exigem os campos de localização', () => {
    expect(researchSchema.safeParse({ niche: 'Escola', scope: 'estado', target: 10 }).success).toBe(false);
    expect(researchSchema.safeParse({ niche: 'Escola', scope: 'estado', state: 'XX', target: 10 }).success).toBe(false);
    expect(researchSchema.parse({ niche: 'Escola', scope: 'estado', state: 'MG', city: 'Ignorada', target: 10 })).toMatchObject({ state: 'MG', city: undefined });
    expect(researchSchema.safeParse({ niche: 'Escola', scope: 'cidade', state: 'SP', target: 10 }).success).toBe(false);
    expect(researchSchema.safeParse({ niche: 'Escola', scope: 'cidade', city: 'Bauru', target: 10 }).success).toBe(false);
    expect(researchSchema.parse({ niche: 'Escola', scope: 'cidade', state: 'SP', city: 'Bauru', target: 10 })).toMatchObject({ state: 'SP', city: 'Bauru' });
  });
  it('quantidade: inteiro positivo até o limite operacional', () => {
    for (const ok of [1, 10, 50, 100, 200, 500, 1000]) expect(researchSchema.safeParse({ niche: 'Academia', scope: 'brasil', target: ok }).success).toBe(true);
    for (const bad of [0, -1, 1.5, 1001, 'abc']) expect(researchSchema.safeParse({ niche: 'Academia', scope: 'brasil', target: bad }).success).toBe(false);
  });
  it('rótulo da localização', () => {
    expect(locationLabel({ location_scope: 'brasil' })).toBe('Brasil inteiro');
    expect(locationLabel({ location_scope: 'estado', location_state: 'SP' })).toBe('São Paulo');
    expect(locationLabel({ location_scope: 'cidade', location_state: 'SP', location_city: 'Bauru' })).toBe('Bauru/SP');
  });
});

describe('foco do cadastro', () => {
  it('cadastra presença não verificada para enriquecer', () => {
    expect(registrationFocus({ site_status: 'verificacao_pendente' }).accepted).toBe(true);
    expect(registrationFocus({ site_status: 'site_nao_localizado' }).accepted).toBe(true);
  });
  it('descarta site próprio sem lacuna comprovada', () => {
    expect(registrationFocus({ site_status: 'site_proprio_encontrado', website_url: 'https://x.test' }).accepted).toBe(false);
  });
});
