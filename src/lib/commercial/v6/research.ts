import type { Readiness, V6Context } from "./contracts";
import { researchFocus } from "../research-focus";
const norm=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function verifiedEvidence(ctx:Pick<V6Context,'research'>){return (ctx.research.evidences??[]).filter(e=>e.url&&e.observed_at&&!e.limitation);}
export function evaluateReadiness(ctx:Pick<V6Context,'research'|'business_name'|'city'|'do_not_contact'|'recipient_timezone'>):Readiness {
  if(ctx.do_not_contact)return {status:'DO_NOT_CONTACT',reasons:['Contato bloqueado'],confidence:0};
  const evidence=verifiedEvidence(ctx);
  const domains=new Set(evidence.map(e=>{try{return new URL(e.url!).hostname;}catch{return '';}}).filter(Boolean));
  const missing=[];
  if(!ctx.business_name||!ctx.city)missing.push('Nome ou cidade não confirmados');
  if(!ctx.recipient_timezone)missing.push('Fuso do destinatário não confirmado');
  if(!ctx.research.diagnosis)missing.push('Diagnóstico ausente');
  if(!evidence.length)missing.push('Fontes verificáveis ausentes');
  const services=(ctx.research.services??[]).filter(s=>evidence.some(e=>norm(e.summary).includes(norm(s))));
  if(!services.length)missing.push('Serviços sem evidência suficiente');
  if(missing.length)return {status:'NEEDS_RESEARCH',reasons:missing,confidence:0};
  const focus=researchFocus(ctx.research);
  if(!focus.qualified)return {status:'NOT_QUALIFIED',reasons:[focus.reason],confidence:0};
  if(ctx.research.diagnosis?.offer==='nao_recomendado')return {status:'NOT_QUALIFIED',reasons:['Solução não recomendada pelo diagnóstico'],confidence:0};
  if(domains.size<2||ctx.research.diagnosis?.confidence==='baixa')return {status:'LOW_CONFIDENCE',reasons:['Confirmar identidade e diagnóstico em fontes independentes'],confidence:domains.size<2?0.5:0.65};
  const supported=(ctx.research.diagnosis?.pains??[]).some(p=>p.evidence.length>3&&evidence.some(e=>norm(e.summary).includes(norm(p.evidence))));
  if(!supported)return {status:'NEEDS_RESEARCH',reasons:['Oportunidade sem observação verificável'],confidence:0.5};
  return {status:'READY_FOR_OUTREACH',reasons:['Identidade, serviços, diagnóstico, oportunidade e fuso disponíveis'],confidence:domains.size>=3?0.95:0.85};
}
