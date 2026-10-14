import { describe, expect, it } from 'vitest';
import { researchFocus } from '@/lib/commercial/research-focus';

describe('foco da pesquisa comercial', () => {
  it('aceita profissional sem página própria', () => {
    expect(researchFocus({site_status:'apenas_redes_sociais'}).qualified).toBe(true);
  });
  it('rejeita presença ainda não verificada', () => {
    expect(researchFocus({site_status:'verificacao_pendente'}).qualified).toBe(false);
  });
  it('rejeita ajustes pequenos em site existente', () => {
    expect(researchFocus({site_status:'site_proprio_encontrado',website_url:'https://clinica.test',evidences:[{kind:'site',url:'https://clinica.test',observed_at:'2026-10-14',summary:'Botão de endereço incorreto'}],diagnosis:{pains:[{pain:'Corrigir botão de endereço',evidence:'Botão de endereço incorreto'}]}}).qualified).toBe(false);
  });
  it('aceita site existente somente com busca de Google documentada', () => {
    expect(researchFocus({site_status:'site_proprio_encontrado',website_url:'https://clinica.test',evidences:[{kind:'busca',url:'https://www.google.com/search?q=botox+bauru',observed_at:'2026-10-14',summary:'Na busca por botox Bauru, o site da clínica não aparece na primeira página'}],diagnosis:{pains:[{pain:'Baixa visibilidade no Google',evidence:'o site da clínica não aparece na primeira página'}]}}).qualified).toBe(true);
  });
});
