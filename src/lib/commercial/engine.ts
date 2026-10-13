/** Motor comercial determinístico. Conteúdo pesquisado/recebido é dado, nunca instrução. */
import { isOptOutText } from "@/lib/envio/respostas";
import { todaySP } from "@/lib/time";
import { selectDemonstration, type Demonstration, type DemoHistory } from "./demonstrations";
export const STAGES = ["NOVO", "PESQUISADO", "QUALIFICADO", "PRONTO_PARA_CONTATO", "CONTATO_ENVIADO", "RESPOSTA_RECEBIDA", "TRIAGEM_RECEPCAO", "AGUARDANDO_RESPONSAVEL", "CONTATO_COM_DECISOR", "APRESENTACAO_AUTORIZADA", "VIDEO_ENVIADO", "INTERESSE_IDENTIFICADO", "QUALIFICACAO_COMERCIAL", "PROPOSTA_SOLICITADA", "PROPOSTA_ENVIADA", "NEGOCIACAO", "VENDA_FECHADA", "PERDIDO", "SEM_RESPOSTA", "NAO_CONTATAR"] as const;
export const ROLES = ["UNKNOWN", "AUTOMATED_ATTENDANT", "RECEPTIONIST", "SECRETARY", "MANAGER", "MARKETING_RESPONSIBLE", "OWNER", "DECISION_MAKER", "AUTHORIZED_INTERMEDIARY"] as const;
export type Stage = typeof STAGES[number];
export type Role = typeof ROLES[number];
export type Strategy = "A" | "B" | "C";
export type Message = { direction: string; body: string | null; kind?: string; media?: string; occurred_at?: string };
export type Evidence = { kind: string; summary: string; url?: string | null; observed_at?: string | null; limitation?: string | null };
export type Research = { niche?: string | null; services?: string[] | null; site_status?: string | null; website_url?: string | null; evidences?: Evidence[]; diagnosis?: { offer?:string; pains?: { pain: string; evidence: string }[]; opportunities?: string[]; confidence?: string } | null };
export type Product = { id?: string; name: string; price: number; scope: string; conditions: string; delivery_days: number | null; approved: boolean };
export type CommercialState = {
  stage: Stage; role: Role; role_confidence: number; role_evidence: string;
  strategy: Strategy; video_offered: boolean; video_authorized: boolean; video_sent_at: string | null;
  facts: Record<string, string>; followup_at: string | null; followup_reason: string | null;
};
export type Context = {
  business_name: string; city?: string; research: Research; state: CommercialState;
  messages: Message[]; products: Product[]; video_configured: boolean;
  manual: boolean; do_not_contact: boolean; first_contact: boolean; now: string;
  memory?: { summary?: string; facts?: string; objections?: string; next_action?: string } | null;
  demonstrations?:Demonstration[]; demonstration_history?:DemoHistory[];
};
export type Decision = {
  intent: string; objective: string; reason: string; action: "text" | "video" | "demonstration" | "handoff" | "stop" | "wait";
  body: string | null; state: CommercialState; notification: string | null;
  demonstration_id?:string;
};
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function identifyRole(text: string, automated = false): { role: Role; confidence: number; evidence: string } {
  if (automated) return { role: "AUTOMATED_ATTENDANT", confidence: 1, evidence: "Evento classificado como atendimento automático" };
  const n = norm(text);
  const rules: [RegExp, Role][] = [
    [/\b(sou|eu sou|aqui e|quem fala e) (a |o |uma |um )?(proprietaria|proprietario|dona|dono|socia|socio)\b/, "OWNER"],
    [/\b(sou|eu sou|aqui e) (a |o )?(responsavel (pelo |por |do )?marketing|marketing)\b|\b(cuido|sou responsavel) (do|pelo) marketing\b/, "MARKETING_RESPONSIBLE"],
    [/\b(sou|eu sou|aqui e) (a |o )?gerente\b/, "MANAGER"],
    [/\b(sou|eu sou|aqui e) (a |o |uma |um )?recepcionista\b|\baqui e (a )?recepcao\b/, "RECEPTIONIST"],
    [/\b(sou|eu sou|aqui e) (a |o |uma |um )?secretari[ao]\b/, "SECRETARY"],
    [/\b(eu decido|sou responsavel pela contratacao|posso contratar)\b/, "DECISION_MAKER"],
    [/\bpode falar comigo\b|\b(estou autorizad[ao]|posso (avaliar|encaminhar) a proposta)\b/, "AUTHORIZED_INTERMEDIARY"],
  ];
  for (const [r, role] of rules) { const m = r.exec(n); if (m) return { role, confidence: 0.95, evidence: text }; }
  return { role: "UNKNOWN", confidence: 0, evidence: "Cargo não confirmado" };
}

/** Pontos só quando há evidência verificável; ausência de site numa busca não rende pontos. */
export function scoreResearch(research: Research, now: string) {
  const evidence = (research.evidences ?? []).filter((e) => e.url && e.observed_at && !e.limitation);
  const source = norm(evidence.map((e) => e.summary).join(" "));
  const niche = /estetica|harmonizacao|biomedic.*estet/.test(source) ? 20 : 0;
  const opportunity = (research.diagnosis?.pains ?? []).some((p) => evidence.some((e) => norm(e.summary).includes(norm(p.evidence)))) ? 25 : 0;
  const recent = evidence.some((e) => {
    const activityDate=/\b(?:publicacao|atividade|atendimento) (?:em|de|no dia) (\d{4}-\d{2}-\d{2})/.exec(norm(e.summary))?.[1];
    const age=activityDate ? Date.parse(now)-Date.parse(activityDate) : NaN;
    return age>=0 && age<=30*86400000;
  }) ? 15 : 0;
  const benefit = opportunity > 0 && /procedimento|tratamento|agendamento|whatsapp/.test(source) ? 15 : 0;
  const channel = evidence.some((e) => e.kind !== "diretorio" && /whatsapp comercial|telefone comercial|canal comercial/.test(norm(e.summary))) ? 15 : 0;
  const personal = evidence.length >= 2 && (research.services ?? []).some((s) => source.includes(norm(s))) ? 10 : 0;
  const components = { nicho: niche, oportunidade: opportunity, atividade: recent, beneficio: benefit, canal: channel, personalizacao: personal };
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  const domains=new Set(evidence.map(e=>{try{return new URL(e.url!).hostname;}catch{return "";}}).filter(Boolean));
  const coverage=(research.evidences?.length ?? 0) ? Math.round(100*evidence.length/research.evidences!.length) : 0;
  const confidence=Math.min(coverage,domains.size>=2 ? 100 : 60);
  return { score, confidence, priority: score >= 80 ? "muito_alta" : score >= 60 ? "alta" : score >= 40 ? "media" : "baixa", components,
    reasons: Object.entries(components).map(([name, points]) => `${name}: ${points} pontos${points ? "; evidência disponível" : "; evidência insuficiente"}`) };
}

export function initialMessage(strategy: Strategy, research: Research): string {
  const confirmedSite = research.site_status === "site_proprio_encontrado" && !!research.website_url;
  const intro = "Sou o Marcos, da MKTech Dev. Trabalho com páginas profissionais para clínicas de estética.";
  if (strategy === "A") return `${intro} Tenho uma ideia para organizar a apresentação dos procedimentos e facilitar o contato com a clínica. Posso te mostrar um exemplo rápido?`;
  if (strategy === "B") return `${intro} ${confirmedSite ? "Como vocês avaliam hoje a forma como o site apresenta os tratamentos e facilita o contato?" : "Hoje vocês usam uma página própria para apresentar os procedimentos ou concentram essas informações no Instagram e no WhatsApp?"}`;
  return `${intro} Tenho um vídeo curto mostrando como uma página pode reunir tratamentos e canais de contato. Posso te enviar?`;
}

export function decide(ctx: Context): Decision {
  const s: CommercialState = { ...ctx.state, facts: { ...ctx.state.facts } };
  let detectedNotification:string|null=null;
  const done = (intent: string, body: string | null, action: Decision["action"] = "text", reason = intent, notification: string | null = null): Decision => ({ intent, objective: intent, reason, action, body, state: s, notification:notification ?? detectedNotification });
  const chooseDemo=()=>selectDemonstration(ctx.demonstrations ?? [],ctx.messages.filter(m=>m.direction==="entrada"&&m.kind!=="automatica").map(m=>m.body??""),s.facts.escopo ?? ctx.research.diagnosis?.offer);
  const offerDemo=(d:Demonstration|undefined):Decision=>{
    if(d)s.facts.demo_recommended=d.id;
    if(!d||!d.available)return done("demonstracao_indisponivel",null,"handoff","Material adequado indisponível","Verificar demonstração comercial");
    s.facts.demo_recommended=d.id;s.facts.demo_offered=d.id;s.video_offered=d.kind==="video";
    const sent=ctx.demonstration_history?.find(h=>h.demonstration_id===d.id&&["enviada","entregue","desconhecido","enviando"].includes(h.status));
    if(sent)return done("demonstracao_ja_registrada",sent.sent_at ? "Esse exemplo já está nesta conversa. Ficou alguma dúvida sobre como adaptar a ideia à sua empresa?" : null,sent.sent_at ? "text" : "handoff","Não repetir material já enviado ou com resultado pendente");
    return {...done("demonstracao_oferecida",d.offer),demonstration_id:d.id};
  };
  if (ctx.do_not_contact || ["PERDIDO", "NAO_CONTATAR", "VENDA_FECHADA"].includes(s.stage)) return done("encerrado", null, "stop");
  if (ctx.manual) return done("controle_manual", null, "wait");
  if (ctx.first_contact) {
    if(s.strategy==="C" && ctx.demonstrations){s.stage="PRONTO_PARA_CONTATO";const offer=offerDemo(chooseDemo());return {...offer,body:offer.body ? `Sou o Marcos, da MKTech Dev. ${offer.body}` : null};}
    if (s.strategy === "C" && !ctx.video_configured) return done("material_ausente", null, "handoff", "Configurar vídeo antes de usar estratégia C", "Material visual não configurado");
    s.stage = "PRONTO_PARA_CONTATO"; s.video_offered = s.strategy === "C";
    return done("primeiro_contato", initialMessage(s.strategy, ctx.research));
  }
  const incoming = ctx.messages.filter((m) => m.direction === "entrada");
  const last = incoming.filter(m=>m.kind!=="automatica").at(-1) ?? incoming.at(-1);
  if (!last) return done("sem_entrada", null, "wait");
  const text = last.body ?? ""; const n = norm(text);
  if (isOptOutText(text)) { s.stage = "NAO_CONTATAR"; s.followup_at = null; s.followup_reason = null; return done("recusa", null, "stop", "Recusa encerra todos os acompanhamentos", "Oportunidade encerrada por recusa"); }
  if (last.kind === "automatica") return done("atendimento_automatico", null, "wait");
  if (last.media && last.media !== "texto") return done("anexo_sem_interpretacao", null, "handoff", "Anexo precisa de interpretação humana", "Áudio ou anexo recebido");
  const role = identifyRole(text);
  if (role.role !== "UNKNOWN") { s.role = role.role; s.role_confidence = role.confidence; s.role_evidence = role.evidence; }
  if (/\b(tenho interesse|temos interesse|gostei|faz sentido)\b/.test(n)) {
    s.facts.interesse_confirmado=text;
    detectedNotification=s.role==="OWNER" ? "Proprietária demonstrou interesse" : "Interesse comercial identificado";
  }
  // Informações explicitamente declaradas no histórico não se perdem nem se repetem.
  for (const m of [...incoming.filter((m) => m.kind !== "automatica"), ...(ctx.memory?.facts ? [{body:ctx.memory.facts}] : [])]) {
    const t = norm(m.body ?? "");
    if (/ja (temos|tenho|possui|tem) (um )?site/.test(t)) s.facts.site = "Site existente confirmado pelo contato";
    if (/\b(quero|queremos|precisamos de) (um )?site institucional\b/.test(t)) s.facts.escopo="site_institucional";
    if (/\b(so|apenas|somente|direcionar para o|pelo) whatsapp\b/.test(t)) s.facts.contato = "WhatsApp";
    if (/\bnao (quero|queremos|precisamos|gostaria|gostariamos) (de |um )?agendamento/.test(t)) s.facts.agendamento = "Não solicitado";
    else if (/\b(quero|queremos|precisamos|gostaria|gostariamos) (de |um )?agendamento/.test(t)) s.facts.agendamento = "Solicitado";
    const procedures = /(?:destacar|oferecemos|trabalhamos com|procedimentos sao)\s+(.{3,200})/i.exec(m.body ?? "");
    if (procedures) s.facts.procedimentos = procedures[1];
  }
  const lastOut = ctx.messages.filter((m) => m.direction === "saida").at(-1)?.body ?? "";
  if(ctx.demonstrations){const recommendation=chooseDemo();if(recommendation)s.facts.demo_recommended=recommendation.id;}
  if (/quais procedimentos.*destacar/.test(norm(lastOut)) && text.length <= 200 && text.length >= 3 && !/\?|nao|quanto|proposta|retorne|bom dia/.test(n)) s.facts.procedimentos = text;
  if (/desconto|condicao especial|contrato|reclamacao|reembolso|ja paguei|fiz o pix|comprovante|garant.*pacient|garant.*fatur/.test(n)) return done("excecao_comercial", null, "handoff", "Condição ou compromisso fora das regras comuns", "Negociação exige decisão do Marcos");
  if (/\b(robo|bot|inteligencia artificial)\b|voce e (uma? )?ia/.test(n)) return done("identidade", "Este atendimento usa um assistente digital da MKTech Dev. Vou encaminhar sua conversa para o Marcos.", "handoff", "Responder com transparência", "Contato perguntou sobre o assistente");
  if (/\b(quanto|preco|valor|custa|investimento)\b/.test(n) && !/caro/.test(n)) {
    s.stage = "NEGOCIACAO";
    const scope=s.facts.agendamento==="Solicitado" ? "agendamento" : s.facts.escopo ?? "landing_page_whatsapp";
    const product = ctx.products.find((p) => p.approved && p.price > 0 && p.scope === scope);
    if (!product && (s.facts.agendamento === "Solicitado" || s.facts.contato || s.facts.escopo)) return done("preco_sem_tabela", null, "handoff", "Escopo confirmado sem tabela oficial aplicável", "Cadastrar preço para o escopo solicitado");
    if (!product) return done("preco_sem_escopo_aprovado", "Para apresentar uma opção adequada: vocês procuram uma página para os procedimentos e contato pelo WhatsApp ou também precisam de agendamento?", "text", "Não inventar valor ou aplicar tabela de outro escopo");
    const price = product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    s.facts.quoted_product_id=product.id ?? product.scope;
    const description=scope==="agendamento" ? "para agendamento" : scope==="site_institucional" ? "para site institucional" : "para apresentar os procedimentos e direcionar ao WhatsApp";
    return done("preco_oficial", `A opção ${product.name}, ${description}, tem investimento de ${price}. ${product.conditions}${product.delivery_days ? ` Prazo: ${product.delivery_days} dias após recebermos os materiais necessários.` : ""} Você procura esse escopo?`);
  }
  if (/caro|fora do orcamento/.test(n)) return done("objecao_preco", "Entendo! O investimento precisa fazer sentido para a clínica. Podemos avaliar quais funcionalidades são necessárias e verificar uma opção mais enxuta. O que seria indispensável para vocês?");
  if (/manda.*proposta|mande.*proposta|envia.*proposta|envi.*orcamento|quero.*proposta|manda.*orcamento|mande.*orcamento|quero.*orcamento/.test(n)) {
    s.stage = "PROPOSTA_SOLICITADA";
    s.facts.proposta_solicitada = "Sim";
    if (s.facts.agendamento==="Solicitado" || s.facts.escopo==="site_institucional") return done("proposta_especializada",null,"handoff","Proposta fora do modelo aprovado de landing page","Lead solicitou proposta de escopo especializado");
    const product = ctx.products.find((p) => p.approved && p.scope === "landing_page_whatsapp" && p.price > 0);
    if (s.facts.procedimentos && s.facts.contato === "WhatsApp" && s.facts.agendamento !== "Solicitado" && product) {
      s.facts.proposta_valor = String(product.price);
      s.facts.quoted_product_id=product.id ?? product.scope;
      return done("proposta_preparada", `Proposta MKTech Dev: ${product.name}, com apresentação dos procedimentos e contato pelo WhatsApp. Investimento: ${product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. ${product.conditions} Agendamento não está incluído neste escopo. Quer esclarecer algum detalhe?`, "text", "Modelo oficial com escopo e preço aprovados", "Proposta preparada para envio");
    }
    return done("proposta_solicitada", s.facts.procedimentos ? "Perfeito! A página deve direcionar para o WhatsApp ou vocês também precisam de agendamento?" : "Perfeito! Quais procedimentos vocês gostariam de destacar na página?", "text", "Registrar solicitação e perguntar somente o detalhe que falta", "Lead solicitou proposta");
  }
  if (s.facts.proposta_solicitada && s.facts.procedimentos && s.facts.contato === "WhatsApp" && s.facts.agendamento !== "Solicitado" && !s.facts.proposta_valor && !/retorn|me cham|amanha|semana que vem|vou pensar|vou analisar/.test(n)) {
    const product = ctx.products.find((p) => p.approved && p.scope === "landing_page_whatsapp" && p.price > 0);
    if (!product) return done("proposta_sem_tabela", null, "handoff", "Proposta depende de catálogo aprovado", "Proposta exige tabela comercial");
    s.facts.proposta_valor = String(product.price);
    s.facts.quoted_product_id=product.id ?? product.scope;
    return done("proposta_preparada", `Proposta MKTech Dev: ${product.name}, com apresentação dos procedimentos e contato pelo WhatsApp. Investimento: ${product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. ${product.conditions} Agendamento não está incluído neste escopo. Quer esclarecer algum detalhe?`, "text", "Modelo oficial com escopo e preço aprovados", "Proposta preparada para envio");
  }
  if (/aceito|vamos fechar|quero contratar|como contrat/.test(n)) { s.stage = "NEGOCIACAO"; return done("contratacao", "Perfeito! Vou encaminhar os detalhes para confirmarmos a contratação com as condições combinadas.", "handoff", "Não confirmar contrato ou pagamento automaticamente", "Cliente demonstrou intenção de contratar"); }
  if (/ja (temos|tenho|tem|possui) (um )?site/.test(n)) return done("site_existente", "Perfeito! Vocês estão satisfeitos com a forma como o site apresenta os procedimentos e facilita o contato?");
  if (/ja temos (uma |um )?(pessoa|equipe|profissional)|alguem cuidando/.test(n)) return done("fornecedor_existente", "Entendi, obrigado por me contar. Se fizer sentido avaliar alguma melhoria no futuro, fico à disposição.");
  // Autorização é contextual: um 'sim' só autoriza o vídeo se a última oferta foi de vídeo.
  if(ctx.demonstrations){
    const offered=ctx.demonstrations.find(d=>d.id===s.facts.demo_offered && d.approved);
    if(/\bnao (quero|preciso|mande|envie|enviar) (o |esse |um |a |essa |uma )?(video|link|exemplo|demonstracao|portfolio|site)/.test(n)){delete s.facts.demo_offered;s.video_offered=false;return done("demonstracao_recusada",null,"wait","Material recusado; não insistir");}
    const selected=chooseDemo();
    if(offered && selected && selected.id!==offered.id && selected.match_terms.some(term=>n.includes(norm(term))))return offerDemo(selected);
    const permission=/\b(pode (mandar|enviar)|pode sim|sim|claro|autorizo|mande|envie|manda|envia)\b/.test(n)&&!/\bnao\b/.test(n);
    if(offered && permission && norm(lastOut).includes(norm(offered.name)) && /posso.*(enviar|mandar)/.test(norm(lastOut))){
      const already=ctx.demonstration_history?.find(h=>h.demonstration_id===offered.id&&h.status!=="cancelada");
      if(already)return offerDemo(offered);
      if(!offered.available)return done("demonstracao_indisponivel",null,"handoff","Material autorizado indisponível","Verificar demonstração comercial");
      s.facts.demo_authorized=offered.id;s.stage="APRESENTACAO_AUTORIZADA";s.video_authorized=offered.kind==="video";
      return {...done("demonstracao_autorizada",offered.caption,"demonstration","Autorização contextual para material cadastrado"),demonstration_id:offered.id};
    }
    if(/exemplo|demonstracao|portfolio|site vitrine|apresentacao de produtos|site institucional|landing page|que ideia|como funciona|vou (passar|encaminhar)/.test(n)
      || (selected?.match_terms.some(term=>n.includes(norm(term))) && !s.facts.proposta_solicitada && !ctx.demonstration_history?.some(h=>h.demonstration_id===selected.id&&h.sent_at))
      || (role.role!=="UNKNOWN"&&["OWNER","MANAGER","MARKETING_RESPONSIBLE","AUTHORIZED_INTERMEDIARY","DECISION_MAKER"].includes(role.role))
      || (/posso te mostrar/.test(norm(lastOut))&&/\b(pode|sim|claro)\b/.test(n)&&!/\bnao\b/.test(n))){
      if(/vou (passar|encaminhar)/.test(n))s.stage="AGUARDANDO_RESPONSAVEL";
      else if(["OWNER","MANAGER","MARKETING_RESPONSIBLE","DECISION_MAKER"].includes(s.role))s.stage="CONTATO_COM_DECISOR";
      return offerDemo(chooseDemo());
    }
  }
  if (/nao (quero|preciso|mande|envie) (o |esse |um )?video/.test(n)) { s.video_offered=false; return done("video_recusado",null,"wait","Material recusado; não enviar nem insistir"); }
  const lastOffer = /video/.test(norm(lastOut)) && /posso.*(enviar|mandar)|posso te enviar/.test(norm(lastOut));
  const consent = /\b(pode (mandar|enviar)|pode sim|sim|claro|autorizo)\b/.test(n) && !/\bnao\b/.test(n);
  if (s.video_offered && lastOffer && consent) {
    s.video_authorized = true; s.stage = "APRESENTACAO_AUTORIZADA";
    if (/passar|encaminhar/.test(n)) s.facts.encaminhamento = "Apresentação será encaminhada à responsável";
    if (s.video_sent_at) return done("video_ja_enviado", "O vídeo já está nesta conversa. Se surgir alguma dúvida sobre a ideia, fico à disposição.");
    if (!ctx.video_configured) return done("video_indisponivel", null, "handoff", "Vídeo autorizado, mas material não configurado", "Configurar vídeo demonstrativo");
    return done("video_autorizado", "Perfeito! Este vídeo mostra como uma página pode organizar os serviços da clínica e facilitar o contato de quem está interessado.", "video");
  }
  if (/posso te mostrar/.test(norm(lastOut)) && /\b(pode|sim|claro)\b/.test(n) && !/\bnao\b/.test(n)) {
    s.stage="APRESENTACAO_AUTORIZADA";s.video_offered=true;
    return done("apresentacao_autorizada", "A ideia é uma página com a identidade da clínica, reunindo tratamentos e contato pelo WhatsApp. Tenho um vídeo mostrando um exemplo. Posso te enviar?");
  }
  if (/vou (passar|encaminhar)|encaminharei/.test(n)) { s.stage = "AGUARDANDO_RESPONSAVEL"; s.video_offered = true; return done("encaminhamento", "Muito obrigado! Posso te enviar um vídeo curto para encaminhar à responsável?", "text", "Encaminhamento confirmado; pedir autorização do material"); }
  if (s.role === "AUTHORIZED_INTERMEDIARY") { s.video_offered = true; return done("intermediario_autorizado", "Perfeito! A ideia é uma página com a identidade da clínica, reunindo os procedimentos e facilitando o contato pelo WhatsApp. Tenho um vídeo mostrando como funciona. Posso te enviar?"); }
  if (/nao esta|nao se encontra/.test(n)) { s.stage = "AGUARDANDO_RESPONSAVEL"; return done("responsavel_ausente", "Sem problemas! Existe um horário melhor para falar com a responsável ou posso deixar uma apresentação para ela avaliar?"); }
  const returnRequested=/retorn|me cham|me chama|entre em contato|fale comigo/.test(n) || /qual (dia|data).*horario.*retorno|qual horario.*retornar/.test(norm(lastOut));
  if (returnRequested) {
    const today=todaySP(new Date(ctx.now));
    const brDate=/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(n);
    let requestedDate=/\b\d{4}-\d{2}-\d{2}\b/.exec(n)?.[0] ?? (brDate ? `${brDate[3] ?? today.slice(0,4)}-${brDate[2].padStart(2,"0")}-${brDate[1].padStart(2,"0")}` : s.facts.retorno_data);
    if (/\bamanha\b/.test(n)) { const tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);requestedDate=tomorrow.toISOString().slice(0,10); }
    const hour=/\bas\s+(\d{1,2})(?:(?::|h)(\d{2})?)?\b/.exec(n) ?? /\b(\d{1,2}):(\d{2})\b/.exec(n);
    const calendarDate=requestedDate ? Date.parse(`${requestedDate}T00:00:00Z`) : NaN;
    if (requestedDate && Number.isFinite(calendarDate) && new Date(calendarDate).toISOString().slice(0,10)===requestedDate && requestedDate>=today) {
      s.facts.retorno_data=requestedDate;
      if (!hour) return done("combinar_horario", "Qual horário seria melhor para retornar nessa data?");
      const date=`${requestedDate}T${hour[1].padStart(2,"0")}:${hour[2] ?? "00"}:00-03:00`;
      if (Number(hour[1])<24 && Number(hour[2] ?? 0)<60 && Date.parse(date)>Date.parse(ctx.now)) { s.followup_at=date;s.followup_reason=text;return done("retorno_combinado","Combinado! Vou retornar na data e no horário que você indicou."); }
    }
  }
  if (/retorn|me cham|outro dia|amanha|semana que vem|vou pensar|vou analisar/.test(n)) return done("combinar_retorno", "Claro, sem problemas! Qual dia e horário seriam bons para um retorno?");
  if (/assisti|vi o video/.test(n)) { s.facts.video_assistido = "Contato confirmou que assistiu"; return done("video_assistido", "O que achou da ideia? A página seria personalizada com a identidade e os procedimentos da sua clínica."); }
  if (/que ideia|como funciona|me explica|explique/.test(n)) { s.video_offered = true; return done("explicacao", "É uma página com a identidade da clínica para reunir tratamentos, informações e contato pelo WhatsApp, complementando o Instagram. Tenho um vídeo mostrando isso na prática. Posso te enviar?"); }
  if (/por que|porque.*precis/.test(n)) return done("valor_da_pagina", "Uma página própria pode reunir os procedimentos, diferenciais e formas de contato em um só endereço, facilitando a experiência de quem está conhecendo a clínica.");
  if (/interess|gostei|faz sentido|legal|quero saber/.test(n)) { s.stage = "INTERESSE_IDENTIFICADO"; return done("interesse", s.facts.procedimentos ? "A página deve direcionar para o WhatsApp ou vocês também precisam de agendamento?" : "Que bom que a ideia fez sentido! Quais procedimentos vocês gostariam de destacar?", "text", "Qualificar uma necessidade por vez", "Interesse comercial identificado"); }
  if (s.facts.procedimentos && !s.facts.contato && !s.facts.agendamento) { s.stage = "QUALIFICACAO_COMERCIAL"; return done("qualificar_contato", "A página deve direcionar para o WhatsApp ou vocês também precisam de agendamento?"); }
  if (["OWNER", "DECISION_MAKER", "MANAGER", "MARKETING_RESPONSIBLE"].includes(s.role)) {
    s.stage = "CONTATO_COM_DECISOR"; s.video_offered = true;
    return done("decisor", "Prazer! A ideia é reunir procedimentos, informações e canais de contato em uma página com a identidade da clínica. Posso te enviar um vídeo mostrando um exemplo?", "text", "Cargo declarado pelo contato");
  }
  s.stage = "TRIAGEM_RECEPCAO";
  if (ctx.messages.some((m) => m.direction === "saida" && /quem.*(cuida|avalia)/.test(norm(m.body ?? "")))) return done("sem_contexto_suficiente", null, "handoff", "Evitar repetir triagem sem informação nova", "Conversa precisa de interpretação");
  return done("identificar_responsavel", "Sou o Marcos, da MKTech Dev. Gostaria de apresentar uma ideia para a clínica. Quem costuma avaliar propostas sobre o site ou a presença digital de vocês?");
}
