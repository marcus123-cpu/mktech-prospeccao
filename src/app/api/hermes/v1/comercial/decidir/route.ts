import { z } from 'zod';
import { authenticate, parseBody, json, temporaryFailure } from '@/lib/hermes/api';
import { serviceClient } from '@/lib/supabase/admin';
import { proposalSchema, type V6Context } from '@/lib/commercial/v6/contracts';
import { contextualDecision, greetingDecision } from '@/lib/commercial/v6/decision';
import { scoreResearch } from '@/lib/commercial/engine';

export const dynamic='force-dynamic';
const schema=z.object({lease_id:z.string().uuid(),proposal:proposalSchema.optional(),model:z.string().min(1).max(100).optional(),failure:z.enum(['runtime_unavailable','inference_timeout','inference_failed','invalid_model_output']).optional()}).strict();
export async function POST(request:Request){
 const auth=await authenticate(request,'mensagens:escrever');
 if('response' in auth)return auth.response;
 const parsed=await parseBody(request,schema);
 if('response' in parsed)return parsed.response;
 const input=parsed.data;const db=serviceClient();
 if(input.failure){
  const {data,error}=await db.rpc('api_commercial_v6_failure',{p_token:auth.tokenId,p_lease:input.lease_id,p_reason:input.failure});
  return error?temporaryFailure():json(data);
 }
 const snapshot=await db.rpc('api_commercial_v6_snapshot',{p_token:auth.tokenId,p_lease:input.lease_id});
 if(snapshot.error)return temporaryFailure();
 if(!snapshot.data)return json({status:'desatualizada'},409);
 const settings=await db.from('commercial_settings').select('objection_recovery_enabled').eq('id',1).single();
 if(settings.error||!settings.data)return temporaryFailure();
 const ctx:V6Context={...snapshot.data,objection_recovery_enabled:settings.data.objection_recovery_enabled,products:(snapshot.data.products??[]).map((p:{price:unknown})=>({...p,price:Number(p.price)}))};
 if(!ctx.first_contact&&(!input.proposal||!input.model))return json({status:'invalido',errors:['Interpretação e modelo obrigatórios']},422);
 const decision=ctx.first_contact?greetingDecision(ctx):contextualDecision(ctx,input.proposal!,input.model!);
 if(decision.validation_errors.length){
  // Mantém o snapshot para uma única correção automática; nada é gravado/enviado.
  return json({status:'validacao_recusada',errors:decision.validation_errors});
 }
 const {data,error}=await db.rpc('api_commercial_v6_save',{p_token:auth.tokenId,p_lease:input.lease_id,p:{...decision,score:scoreResearch(ctx.research,ctx.now)}});
 if(!error&&data?.status!=='desatualizada'){
  // Aprendizado entra como pendente; sem dados do lead (telefone, link, e-mail) e só com aprovação do administrador.
  const lesson=input.proposal?.learning?.trim();
  if(lesson&&!/https?:|www\.|@|\d{4,}/i.test(lesson))await db.rpc('api_learning_propose',{p_lesson:lesson});
 }
 return error?temporaryFailure():json(data,data?.status==='desatualizada'?409:200);
}
