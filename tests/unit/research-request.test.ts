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

describe('foco do cadastro (critério obrigatório: sem site confirmado)', () => {
  const google = { kind: 'google' as const, summary: 'Busca "nome cidade site": nenhum site próprio nos resultados' };
  const insta = { kind: 'instagram' as const, summary: 'Bio sem link para site' };
  it('aceita só quem teve "sem site" confirmado no Google e na bio do Instagram', () => {
    expect(registrationFocus({ site_status: 'site_nao_localizado', evidences: [google] }).accepted).toBe(true);
    expect(registrationFocus({ site_status: 'apenas_redes_sociais', instagram: '@x', evidences: [google, insta] }).accepted).toBe(true);
  });
  it('recusa verificação pendente ou sem status', () => {
    expect(registrationFocus({ site_status: 'verificacao_pendente', evidences: [google] })).toMatchObject({ accepted: false, code: 'verificacao_pendente' });
    expect(registrationFocus({ evidences: [google] })).toMatchObject({ accepted: false, code: 'verificacao_pendente' });
  });
  it('recusa quem já tem site, mesmo com lacuna no Google', () => {
    expect(registrationFocus({ site_status: 'site_proprio_encontrado', website_url: 'https://x.test', evidences: [google] })).toMatchObject({ accepted: false, code: 'ja_possui_site' });
    expect(registrationFocus({ site_status: 'site_nao_localizado', website_url: 'https://clinicax.com.br', evidences: [google] }).accepted).toBe(false);
  });
  it('link de Instagram, Linktree ou WhatsApp não conta como site próprio', () => {
    expect(registrationFocus({ site_status: 'apenas_redes_sociais', website_url: 'https://linktr.ee/x', evidences: [google] }).accepted).toBe(true);
    expect(registrationFocus({ site_status: 'apenas_redes_sociais', website_url: 'https://www.instagram.com/x', evidences: [google] }).accepted).toBe(true);
  });
  it('exige a busca no Google registrada, sem limitação', () => {
    expect(registrationFocus({ site_status: 'site_nao_localizado', evidences: [] })).toMatchObject({ accepted: false, code: 'sem_busca_google' });
    expect(registrationFocus({ site_status: 'site_nao_localizado', evidences: [{ ...google, limitation: 'sem acesso' }] })).toMatchObject({ accepted: false, code: 'sem_busca_google' });
  });
  it('exige a bio do Instagram verificada quando há Instagram', () => {
    expect(registrationFocus({ site_status: 'apenas_redes_sociais', instagram: '@x', evidences: [google] })).toMatchObject({ accepted: false, code: 'instagram_nao_verificado' });
    expect(registrationFocus({ site_status: 'apenas_redes_sociais', instagram: '@x', evidences: [google, { ...insta, limitation: 'pediu login' }] }).accepted).toBe(false);
  });
});
