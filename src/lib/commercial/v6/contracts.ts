import { z } from "zod";
import type { Context } from "../engine";

export const INTENTS = ["HUMAN_GREETING","AUTOMATED_GREETING","AUTOMATED_GATE","WAIT_REQUEST","SERVICE_ATTENDANT","DECISION_MAKER","CHANNEL_CONFIRMED","WRONG_CHANNEL","CONTACT_REDIRECT","BUSINESS_QUESTION","PRICE_QUESTION","SEO_QUESTION","DEMO_REQUEST","DEMO_REFUSED","INTERESTED","NOT_INTERESTED","OPT_OUT","OBJECTION","FEATURE_DECLINED","SUBJECT_CHANGE","CONTRACT_REQUEST","UNKNOWN"] as const;
export const PHASES = ["NEEDS_RESEARCH","GREETING_PENDING","WAITING_FIRST_REPLY","WAITING_HUMAN","WAITING_CHANNEL_CONFIRMATION","CHANNEL_CONFIRMED","OPPORTUNITY_PRESENTED","DEMO_OFFERED","DEMO_SENT","QUALIFYING","NEGOTIATING","WAITING_RETURN","HUMAN_HANDOFF","CLOSED"] as const;
export const SOLUTIONS = ["landing_page","site_institucional","agendamento","automacao_ia"] as const;
export const factSchema = z.object({key:z.string().max(80),value:z.string().max(500),evidence:z.string().min(1).max(1000),source_id:z.string().min(1).max(2000)}).strict();
export const interpretationSchema = z.object({
  message_id:z.string().uuid(),type:z.enum(["human","automated","uncertain"]),
  intentions:z.array(z.object({kind:z.enum(INTENTS),confidence:z.number().min(0).max(1),evidence:z.string().min(1).max(1000)}).strict()).min(1).max(8),
  confidence:z.number().min(0).max(1),
}).strict();
export const proposalSchema = z.object({
  interpretations:z.array(interpretationSchema).max(20),
  action:z.enum(["wait","respond","handoff","offer_demo","send_demo","stop"]),
  response:z.string().min(1).max(700).nullable(),reason:z.string().min(1).max(500),
  phase:z.enum(PHASES),role:z.enum(["UNKNOWN","AUTOMATED_ATTENDANT","RECEPTIONIST","SECRETARY","MANAGER","MARKETING_RESPONSIBLE","OWNER","DECISION_MAKER","AUTHORIZED_INTERMEDIARY"]),
  role_evidence:z.string().max(1000),solution:z.enum(SOLUTIONS).nullable(),
  opportunity_index:z.number().int().min(0).max(7).nullable(),demonstration_id:z.string().max(100).nullable(),product_id:z.string().uuid().nullable(),
  confirmed_facts:z.array(factSchema).max(25),uncertain_facts:z.array(z.string().max(500)).max(15),
  answered_questions:z.array(z.string().max(300)).max(15),objections:z.array(z.string().max(300)).max(10),
  summary:z.string().max(1500),next_action:z.string().max(500),
  followup_at:z.string().datetime({offset:true}).nullable(),followup_evidence:z.string().max(1000),
  source_ids:z.array(z.string().max(2000)).max(15),
}).strict();
export type SemanticProposal=z.infer<typeof proposalSchema>;
export type Readiness={status:"READY_FOR_OUTREACH"|"NEEDS_RESEARCH"|"LOW_CONFIDENCE"|"NOT_QUALIFIED"|"DO_NOT_CONTACT";reasons:string[];confidence:number};
export type V6Context=Context & {
  objection_recovery_enabled?:boolean;
  campaign_mode?:'none'|'blocked'|'simulacao'|'autonomo';
  lead_id:string;revision:number;reply_id:string|null;lease_id:string;
  phase:typeof PHASES[number];recipient_timezone:string|null;readiness:Readiness;
  followup_due?:boolean;
  answered_reply_ids?:string[];
  pending_messages:{id:string;body:string;media:string;received_at:string;kind:string}[];
  commercial_memory:{summary:string;confirmed_facts:z.infer<typeof factSchema>[];uncertain_facts:string[];answered_questions:string[];objections:string[];next_action:string;solution:string|null;introduced:boolean;channel_confirmed:boolean;wait_acknowledged:string[]};
};
