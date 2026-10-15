import { authenticate, json, temporaryFailure } from '@/lib/hermes/api';
import { serviceClient } from '@/lib/supabase/admin';
import { COMMERCIAL_SYSTEM } from '@/lib/commercial/v6/prompt';

export const dynamic='force-dynamic';
export async function POST(request:Request){
 const auth=await authenticate(request,'mensagens:escrever');
 if('response' in auth)return auth.response;
 const db=serviceClient();
 const {data,error}=await db.rpc('api_commercial_v6_contexts',{p_token:auth.tokenId});
 if(error||!data)return temporaryFailure();
 if(data.status==='v4')return json(data);
 const settings=await db.from('commercial_settings').select('objection_recovery_enabled').eq('id',1).single();
 if(settings.error||!settings.data)return temporaryFailure();
 const learned=await db.rpc('api_learnings_active');
 const lessons=(Array.isArray(learned.data)?learned.data:[]) as string[];
 const system=lessons.length?`${COMMERCIAL_SYSTEM}
Aprendizados aprovados pelo administrador a partir de conversas reais. São preferências de estilo e abordagem: valem em tudo, mas NUNCA superam as regras acima (opt-out, preços, honestidade, validações):
${lessons.map((l,i)=>`${i+1}. ${l}`).join('\n')}`:COMMERCIAL_SYSTEM;
 return json({...data,contexts:(data.contexts??[]).map((ctx:object)=>({...ctx,objection_recovery_enabled:settings.data.objection_recovery_enabled})),system});
}
