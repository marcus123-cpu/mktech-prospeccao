import type { Decision, CommercialState } from "../engine";
import { greetingAt } from "./greeting";
import { evaluateReadiness } from "./research";
import { validateProposal } from "./validation";
import type { SemanticProposal, V6Context } from "./contracts";

export type V6Decision=Decision & {phase:string;memory:V6Context['commercial_memory'];interpretations:SemanticProposal['interpretations'];readiness:ReturnType<typeof evaluateReadiness>;model:string|null;validation_errors:string[]};
export function greetingDecision(ctx:V6Context):V6Decision {
  const readiness=evaluateReadiness(ctx);
  const ready=readiness.status==='READY_FOR_OUTREACH'&&!ctx.manual&&!ctx.do_not_contact;
  return {intent:ready?'greeting_v6':'research_required',objective:'Verificar prontidão antes da saudação',reason:readiness.reasons.join('; '),action:ready?'text':'wait',body:ready?greetingAt(ctx.now,ctx.recipient_timezone!):null,
    state:{...ctx.state,facts:{...ctx.state.facts},stage:ready?'PRONTO_PARA_CONTATO':ctx.state.stage,video_offered:false},notification:null,
    phase:ready?'GREETING_PENDING':'NEEDS_RESEARCH',memory:ctx.commercial_memory,interpretations:[],readiness,model:null,validation_errors:[]};
}
export function contextualDecision(ctx:V6Context,p:SemanticProposal,model:string):V6Decision {
  p={...p,interpretations:[...p.interpretations].sort((a,b)=>ctx.pending_messages.findIndex(m=>m.id===a.message_id)-ctx.pending_messages.findIndex(m=>m.id===b.message_id))};
  const readiness=evaluateReadiness(ctx);const errors=validateProposal(ctx,p);
  const memory={...ctx.commercial_memory,summary:p.summary,confirmed_facts:[...ctx.commercial_memory.confirmed_facts,...p.confirmed_facts].filter((f,i,arr)=>arr.findIndex(x=>x.key===f.key&&x.value===f.value)===i).slice(-50),uncertain_facts:[...new Set([...ctx.commercial_memory.uncertain_facts,...p.uncertain_facts])].slice(-25),answered_questions:[...new Set([...ctx.commercial_memory.answered_questions,...p.answered_questions])].slice(-30),objections:[...new Set([...ctx.commercial_memory.objections,...p.objections])].slice(-20),next_action:p.next_action,solution:p.solution??ctx.commercial_memory.solution};
  const state:CommercialState={...ctx.state,facts:{...ctx.state.facts}};
  const result:V6Decision={intent:p.interpretations.at(-1)?.intentions.map(i=>i.kind).join('+')??'UNKNOWN',objective:p.next_action,reason:p.reason,action:'wait',body:null,state,notification:null,phase:p.phase,memory,interpretations:p.interpretations,readiness,model,validation_errors:errors};
  if(errors.length){return {...result,intent:'validation_failed',reason:errors.join('; '),phase:ctx.phase,memory:ctx.commercial_memory,notification:'Revisar interpretação comercial',interpretations:[]};}
  if(ctx.manual||ctx.do_not_contact)return {...result,intent:'operation_blocked',memory:ctx.commercial_memory};
  if(p.role!=='UNKNOWN'){state.role=p.role;state.role_evidence=p.role_evidence;state.role_confidence=p.interpretations.length?Math.min(...p.interpretations.map(i=>i.confidence)):ctx.state.role_confidence;}
  if(p.solution)state.facts.escopo=p.solution;
  if(p.opportunity_index!==null)state.facts.oportunidade_apresentada=String(p.opportunity_index);
  if(p.followup_at){state.followup_at=p.followup_at;state.followup_reason=p.followup_evidence;}
  const latest=p.interpretations.at(-1);
  if(p.action==='stop'){state.stage=latest?.intentions.some(i=>i.kind==='OPT_OUT')?'NAO_CONTATAR':'PERDIDO';state.followup_at=null;state.followup_reason=null;return {...result,action:'stop',phase:'CLOSED'};}
  if(p.action==='handoff')return {...result,action:'handoff',body:p.response,phase:'HUMAN_HANDOFF',notification:'Intervenção comercial necessária'};
  if(p.action==='wait')return result;
  if(ctx.followup_due&&ctx.pending_messages.length===0){state.followup_at=null;state.followup_reason=null;return {...result,intent:'followup_v6',action:'text',body:p.response};}
  if(latest?.intentions.some(i=>i.kind==='WAIT_REQUEST')){
    const text=(ctx.pending_messages.at(-1)?.body??'').trim().toLowerCase();
    if(memory.wait_acknowledged.includes(text))return {...result,action:'wait',body:null};
  }
  if(p.action==='offer_demo'){
    const demo=ctx.demonstrations?.find(d=>d.id===p.demonstration_id&&d.approved&&d.available);
    if(!demo)return {...result,intent:'demo_unavailable',notification:'Material solicitado indisponível'};
    state.facts.demo_offered=demo.id;state.facts.demo_recommended=demo.id;state.video_offered=demo.kind==='video';
    return {...result,intent:'demonstracao_oferecida',action:'text',body:p.response??demo.offer,demonstration_id:demo.id,phase:'DEMO_OFFERED'};
  }
  if(p.action==='send_demo'){
    const demo=ctx.demonstrations!.find(d=>d.id===p.demonstration_id)!;
    state.facts.demo_authorized=demo.id;state.video_authorized=demo.kind==='video';state.stage='APRESENTACAO_AUTORIZADA';
    return {...result,intent:'demonstracao_autorizada',action:'demonstration',body:demo.caption,demonstration_id:demo.id,phase:'DEMO_OFFERED'};
  }
  if(latest?.intentions.some(i=>i.kind==='CHANNEL_CONFIRMED'||i.kind==='DECISION_MAKER'))memory.channel_confirmed=true;
  state.stage=p.phase==='NEGOTIATING'?'NEGOCIACAO':p.phase==='QUALIFYING'?'QUALIFICACAO_COMERCIAL':p.phase==='OPPORTUNITY_PRESENTED'?'INTERESSE_IDENTIFICADO':state.role==='OWNER'?'CONTATO_COM_DECISOR':'RESPOSTA_RECEBIDA';
  return {...result,action:'text',body:p.response};
}
