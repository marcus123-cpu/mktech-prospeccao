// Análise da prospecção: tipos do que o banco devolve (admin_analysis) e as dicas em português.
export type Linha = { nome: string; enviados: number; responderam: number; apresentacao?: number; continuaram?: number };
export type Exemplo = { id: string; nome: string; desde: string };
export type Analise = {
  funil: { quebra_gelo: number; so_automatica: number; responderam: number; apresentacao: number; responderam_apresentacao: number; proposta: number; fechado: number; recusou: number };
  situacoes: Record<string, number>;
  exemplos: Record<string, Exemplo[]>;
  tempo_cliente_quebra_gelo: { mediana_min: number | null; n: number };
  tempo_voce: { respondidas: number; mediana_min: number | null; p90_min: number | null; ate_5min: number; ate_1h: number; ate_24h: number; mais_de_24h: number };
  sem_resposta_agora: { n: number; mais_antiga_horas: number | null };
  resposta_rapida: { rapido_n: number; rapido_continuou: number; lento_n: number; lento_continuou: number };
  por_nicho: Linha[]; por_horario: Linha[]; por_dia: Linha[]; por_estrategia: Linha[]; por_estilo: Linha[];
};

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** 90 minutos -> "1h30", 5 -> "5 min", 3000 -> "2 dias". */
export function duracao(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`; }
  const d = Math.round(min / 1440); return `${d} dia${d > 1 ? "s" : ""}`;
}

export type Dica = { tom: "ruim" | "atencao" | "bom"; titulo: string; texto: string };

/** Transforma os números do mês em conclusões e ações. Só diz o que os dados sustentam. */
export function dicas(cur: Analise, prev: Analise | null): Dica[] {
  const f = cur.funil;
  const out: Dica[] = [];
  if (f.quebra_gelo < 10) {
    return [{ tom: "atencao", titulo: "Poucos dados neste mês", texto: `Só ${f.quebra_gelo} quebra-gelos foram enviados. Com menos de 10 não dá para tirar conclusões confiáveis: envie mais e volte aqui.` }];
  }
  // 1) Onde está a maior perda
  const perdas = [
    { etapa: "no quebra-gelo (o cliente nem respondeu)", de: f.quebra_gelo, ficaram: f.responderam, perdeu: f.quebra_gelo - f.responderam },
    { etapa: "entre o cliente responder e você apresentar", de: f.responderam, ficaram: f.apresentacao, perdeu: f.responderam - f.apresentacao },
    { etapa: "depois da apresentação (o cliente parou de responder)", de: f.apresentacao, ficaram: f.responderam_apresentacao, perdeu: f.apresentacao - f.responderam_apresentacao },
  ].filter(p => p.de > 0);
  const maior = [...perdas].sort((a, b) => b.perdeu - a.perdeu)[0];
  if (maior) out.push({ tom: "ruim", titulo: `A maior perda é ${maior.etapa}`, texto: `De ${maior.de}, só ${maior.ficaram} seguiram (${pct(maior.ficaram, maior.de)}%). Foram ${maior.perdeu} leads perdidos nesta etapa. É aqui que vale mexer primeiro.` });

  // 2) Quebra-gelo
  const taxa = pct(f.responderam, f.quebra_gelo);
  const taxaAnt = prev && prev.funil.quebra_gelo >= 10 ? pct(prev.funil.responderam, prev.funil.quebra_gelo) : null;
  const delta = taxaAnt === null ? "" : taxa >= taxaAnt ? ` (${taxa - taxaAnt} pontos acima do mês passado)` : ` (${taxaAnt - taxa} pontos abaixo do mês passado)`;
  out.push({ tom: taxa >= 30 ? "bom" : taxa >= 15 ? "atencao" : "ruim", titulo: `Quebra-gelo: ${taxa}% de resposta de pessoas${delta}`,
    texto: taxa >= 30 ? "O quebra-gelo está abrindo conversa. Mantenha o texto e foque no que vem depois." : "Menos de 3 em cada 10 respondem. Teste um quebra-gelo mais curto, com uma pergunta fácil de responder, e compare a taxa no próximo mês." });
  if (f.so_automatica > 0 && pct(f.so_automatica, f.quebra_gelo) >= 20) {
    out.push({ tom: "atencao", titulo: `${f.so_automatica} contatos só devolveram resposta automática`, texto: `São ${pct(f.so_automatica, f.quebra_gelo)}% dos quebra-gelos: o WhatsApp Business respondeu sozinho e ninguém falou depois. Vale tentar de novo em horário comercial, ou mandar uma segunda mensagem pedindo para falar com o responsável.` });
  }

  // 3) Apresentação
  if (f.apresentacao >= 8) {
    const t2 = pct(f.responderam_apresentacao, f.apresentacao);
    out.push({ tom: t2 >= 40 ? "bom" : t2 >= 20 ? "atencao" : "ruim", titulo: `Apresentação: só ${t2}% continuam a conversa`,
      texto: t2 >= 40 ? "Quem recebe a apresentação costuma continuar. Bom sinal." : `${f.apresentacao - f.responderam_apresentacao} de ${f.apresentacao} sumiram depois da apresentação. Teste uma apresentação mais curta, terminando com uma pergunta direta (ex.: "posso te mostrar um exemplo?") em vez de um texto longo.` });
  }
  const parados = cur.situacoes["parou_apos_apresentacao"] ?? 0;
  if (parados > 0) out.push({ tom: "atencao", titulo: `${parados} leads pararam depois da apresentação`, texto: "Vale um segundo contato curto, em outro dia e horário, com algo novo (um exemplo pronto, uma foto do antes e depois do site, uma pergunta). Veja a lista logo abaixo." });

  // 4) Seu tempo de resposta
  const t = cur.tempo_voce;
  if (t.respondidas >= 5 && t.mediana_min !== null) {
    const rapido = pct(t.ate_1h, t.respondidas);
    out.push({ tom: t.mediana_min <= 15 ? "bom" : t.mediana_min <= 60 ? "atencao" : "ruim", titulo: `Você responde em mediana ${duracao(t.mediana_min)}`,
      texto: `${rapido}% das respostas saem em até 1 hora${t.mais_de_24h ? `, e ${t.mais_de_24h} demoraram mais de 1 dia` : ""}. ${t.mediana_min <= 15 ? "Ritmo excelente: quem escreve é atendido rápido." : "Quanto mais rápido, maior a chance de fechar: tente manter a mediana abaixo de 15 minutos."}` });
  }
  if (cur.sem_resposta_agora.n > 0) {
    out.push({ tom: "ruim", titulo: `${cur.sem_resposta_agora.n} cliente(s) esperando sua resposta agora`, texto: `A mais antiga espera há ${duracao((cur.sem_resposta_agora.mais_antiga_horas ?? 0) * 60)}. Responda estas primeiro: são quem já demonstrou interesse.` });
  }
  const r = cur.resposta_rapida;
  if (r.rapido_n >= 8 && r.lento_n >= 3) {
    const a = pct(r.rapido_continuou, r.rapido_n), b = pct(r.lento_continuou, r.lento_n);
    if (a > b) out.push({ tom: "atencao", titulo: "Responder rápido faz diferença", texto: `Quando você respondeu em até 1 hora, ${a}% continuaram a conversa; quando demorou mais, só ${b}%.` });
  }

  // 5) O que funciona melhor (só com amostra mínima)
  const melhor = (linhas: Linha[], min: number) => linhas.filter(l => l.enviados >= min).map(l => ({ ...l, taxa: pct(l.responderam, l.enviados) })).sort((a, b) => b.taxa - a.taxa);
  const nichos = melhor(cur.por_nicho, 8);
  if (nichos.length >= 2) {
    const m = nichos[0], p = nichos[nichos.length - 1];
    if (m.taxa - p.taxa >= 15) out.push({ tom: "atencao", titulo: `Nicho: "${m.nome}" responde mais que "${p.nome}"`, texto: `${m.nome}: ${m.taxa}% de resposta (${m.responderam} de ${m.enviados}). ${p.nome}: ${p.taxa}% (${p.responderam} de ${p.enviados}). Priorize o primeiro e reveja a abordagem do segundo antes de gastar mais envios nele.` });
  }
  const dias = melhor(cur.por_dia, 8);
  if (dias.length >= 2 && dias[0].taxa - dias[dias.length - 1].taxa >= 20) out.push({ tom: "atencao", titulo: `Melhor dia para o quebra-gelo: ${dias[0].nome}`, texto: `${dias[0].nome} teve ${dias[0].taxa}% de resposta; ${dias[dias.length - 1].nome} só ${dias[dias.length - 1].taxa}%. Concentre os envios nos melhores dias.` });
  const horas = melhor(cur.por_horario, 15);
  if (horas.length >= 2 && horas[0].taxa - horas[horas.length - 1].taxa >= 10) out.push({ tom: "atencao", titulo: `Melhor horário: ${horas[0].nome}`, texto: `${horas[0].nome}: ${horas[0].taxa}% de resposta contra ${horas[horas.length - 1].taxa}% em ${horas[horas.length - 1].nome}.` });
  const estr = melhor(cur.por_estrategia, 25);
  if (estr.length >= 2 && estr[0].taxa >= estr[estr.length - 1].taxa * 1.5 && estr[0].taxa - estr[estr.length - 1].taxa >= 8) out.push({ tom: "atencao", titulo: `${estr[0].nome} está ganhando`, texto: `${estr[0].nome}: ${estr[0].taxa}% de resposta; ${estr[estr.length - 1].nome}: ${estr[estr.length - 1].taxa}%. Considere usar mais a que funciona.` });
  return out;
}
