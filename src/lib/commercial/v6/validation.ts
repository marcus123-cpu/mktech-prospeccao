import { isOptOutText } from "@/lib/envio/respostas";
import { verifiedEvidence } from "./research";
import type { SemanticProposal, V6Context } from "./contracts";
const norm=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function unsupportedPromise(text:string):boolean {
  const claims=/garant\w*.{0,30}(pacient|cliente|fatur|receit|google|resultad)|primeir[oa]s?\s+(3|tres)|(3|tres)\s+primeir[oa]s?|top\s*3|posicao garantida|\d+\s*(novos )?(clientes|pacientes)/g;
  for(const clause of text.split(/[.!?;,\n]|\b(?:mas|porem|entretanto)\b/)){
    for(const match of clause.matchAll(claims)){
      const before=clause.slice(0,match.index);
      const near=clause.slice(Math.max(0,match.index!-80),match.index!+match[0].length);
      const directDenial=/\b(?:(?:nao|ninguem|nunca)\s+(?:(?:posso|podemos|pode|consigo|conseguimos|temos|como|e|possivel|ha|existe|vou|vamos|da|para)\s+){0,4}|sem\s+)$/.test(before);
      const contextualDenial=/\b(?:(?:nao|ninguem|nunca)\s+(?:(?:posso|podemos|pode|consigo|conseguimos|temos|como|e|possivel|ha|existe|vou|vamos|da|para)\s+){0,4}(?:garant\w*|promet\w*|assegur\w*)|sem garantia|nenhuma garantia)\b/.test(near);
      if(!directDenial&&!contextualDenial)return true;
    }
  }
  return false;
}
export function sources(ctx:V6Context):Map<string,string>{
  const history=ctx.messages.filter(m=>m.direction==='entrada'&&m.id).flatMap(m=>{
    const rows:[string,string][]=[[m.id!,m.body??'']];
    const canonical=/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):/i.exec(m.id!);
    if(canonical)rows.push([canonical[1],m.body??'']);
    return rows;
  });
  return new Map([...verifiedEvidence(ctx).map(e=>[e.url!,e.summary] as [string,string]),...history,...ctx.pending_messages.map(m=>[m.id,m.body] as [string,string])]);
}
export function validateProposal(ctx:V6Context,p:SemanticProposal):string[]{
  const errors:string[]=[];const known=sources(ctx);const pending=new Map(ctx.pending_messages.map(m=>[m.id,m]));
  if(p.interpretations.length!==pending.size||new Set(p.interpretations.map(i=>i.message_id)).size!==pending.size)errors.push('Classificar uma vez cada mensagem pendente');
  for(const i of p.interpretations){const m=pending.get(i.message_id);if(!m){errors.push('Mensagem de outro contexto');continue;}for(const intent of i.intentions)if(!norm(m.body).includes(norm(intent.evidence)))errors.push('Evidência da intenção ausente na mensagem');}
  for(const fact of p.confirmed_facts)if(!known.get(fact.source_id)||!norm(known.get(fact.source_id)!).includes(norm(fact.evidence)))errors.push('Fato sem fonte literal válida');
  for(const source of p.source_ids)if(!known.has(source))errors.push('Fonte de outro contexto ou sem verificação');
  if(p.role!=='UNKNOWN'&&p.role!=='AUTOMATED_ATTENDANT'&& !(p.role===ctx.state.role&&p.role_evidence===ctx.state.role_evidence)
    &&!ctx.pending_messages.some(m=>p.role_evidence&&norm(m.body).includes(norm(p.role_evidence))))errors.push('Cargo sem evidência literal');
  if(p.role!=='UNKNOWN'&&p.role!==ctx.state.role&&p.interpretations.some(i=>i.confidence<.85))errors.push('Cargo exige interpretação com alta confiança');
  if(p.opportunity_index!==null){const pain=ctx.research.diagnosis?.pains?.[p.opportunity_index];if(!pain||!verifiedEvidence(ctx).some(e=>norm(e.summary).includes(norm(pain.evidence))))errors.push('Oportunidade não sustentada pelo diagnóstico');}
  if(p.followup_at){const date=Date.parse(p.followup_at);if(!Number.isFinite(date)||date<=Date.parse(ctx.now)||!ctx.pending_messages.some(m=>m.body.includes(p.followup_evidence)&&p.followup_evidence.length>3))errors.push('Retorno sem combinação válida');if(!/\d{1,2}(?::\d{2}|h)|\bas\s+\d{1,2}/.test(norm(p.followup_evidence)))errors.push('Horário de retorno não informado');if(!/\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo/.test(norm(p.followup_evidence)))errors.push('Data de retorno não informada');}
  const body=p.response??'';const text=norm(body);
  if(/sou (o |a )?marcos|me chamo marcos|sou (uma )?pessoa|sou humano/.test(text))errors.push('Identidade deve ser de assistente comercial');
  if(unsupportedPromise(text))errors.push('Promessa sem respaldo');
  if(/https?:\/\/|www\./i.test(body))errors.push('Links só saem pelo catálogo de demonstrações');
  if(/mkt_[a-f0-9]{32}|service.role|api.key|token|prompt de sistema/i.test(body))errors.push('Conteúdo operacional não deve ser enviado');
  if(/\b(r\$|reais|valor de|investimento de)\b/.test(text)||/R\$/.test(body)){
    const product=ctx.products.find(item=>item.id===p.product_id&&item.approved&&item.price>0);
    if(!product)errors.push('Preço fora da tabela aprovada');
    else {
      if(!body.includes(product.price.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})))errors.push('Preço difere da tabela');
      const scope=p.solution==='landing_page'?'landing_page_whatsapp':p.solution;
      if(!scope||product.scope!==scope)errors.push('Preço não corresponde ao escopo');
      for(const amount of body.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g))if(Number(amount[1].replaceAll('.','').replace(',','.'))!==product.price)errors.push('Valor adicional não aprovado');
    }
  }
  const waitRequested=p.interpretations.some(i=>i.intentions.some(t=>t.kind==='WAIT_REQUEST'));
  if(p.action==='respond'&&!body)errors.push('Resposta vazia');
  if(['respond','handoff'].includes(p.action)&&body&&!waitRequested&&!ctx.commercial_memory.introduced&&!text.includes('assistente comercial da mktech dev'))errors.push('Primeira resposta comercial deve identificar o assistente');
  if(p.action==='respond'&&ctx.phase==='WAITING_FIRST_REPLY'&&!p.source_ids.some(id=>verifiedEvidence(ctx).some(e=>e.url===id))&& !p.interpretations.some(i=>i.intentions.some(t=>['PRICE_QUESTION','SEO_QUESTION','BUSINESS_QUESTION','WRONG_CHANNEL','CONTACT_REDIRECT','WAIT_REQUEST'].includes(t.kind))))errors.push('Apresentação inicial exige detalhe com fonte verificável');
  const latest=ctx.pending_messages.at(-1);
  const interpreted=p.interpretations.find(i=>i.message_id===latest?.id);
  if(latest&&ctx.answered_reply_ids?.includes(latest.id)&&['respond','offer_demo','send_demo'].includes(p.action))errors.push('Mensagem anterior já recebeu resposta confirmada');
  const followup=ctx.followup_due&&ctx.pending_messages.length===0;
  if(!followup&&latest?.id!==ctx.reply_id&&p.action!=='wait')errors.push('Aguardar interpretação de todas as entradas acumuladas');
  if(latest?.media&&latest.media!=='texto'&&['respond','offer_demo','send_demo'].includes(p.action))errors.push('Anexo exige interpretação humana');
  if(!followup&&(!interpreted||interpreted.type==='uncertain'||interpreted.confidence<0.7)&&['respond','offer_demo','send_demo'].includes(p.action))errors.push('Não enviar com interpretação incerta');
  if(followup&&!['respond','wait','handoff'].includes(p.action))errors.push('Retorno combinado não concede autorização de material');
  if(interpreted?.type==='automated'&&['respond','offer_demo','send_demo'].includes(p.action))errors.push('Aguardar atendimento humano');
  if(latest&&isOptOutText(latest.body)&&p.action!=='stop')errors.push('Opt-out deve encerrar contato');
  if(latest&&p.action==='stop'&&!isOptOutText(latest.body)&&!interpreted?.intentions.some(i=>['OPT_OUT','NOT_INTERESTED','WRONG_CHANNEL'].includes(i.kind)&&i.confidence>=.7))errors.push('Encerramento exige recusa ou canal errado na mensagem atual');
  if(p.action==='send_demo'){
    const demo=ctx.demonstrations?.find(d=>d.id===p.demonstration_id&&d.approved&&d.available);
    if(!demo||ctx.state.facts.demo_offered!==demo.id)errors.push('Material não aprovado/disponível ou não oferecido');
    if(!interpreted||interpreted.type!=='human'||interpreted.confidence<0.85||!interpreted.intentions.some(i=>i.kind==='DEMO_REQUEST'&&i.confidence>=0.85))errors.push('Permissão de material não confirmada');
    if(latest&&/\bnao\b/.test(norm(latest.body)))errors.push('Recusa não autoriza demonstração');
    if(ctx.demonstration_history?.some(h=>h.demonstration_id===p.demonstration_id&&h.status!=='cancelada'))errors.push('Demonstração já registrada');
  }
  return [...new Set(errors)];
}
