import { authenticate, json, temporaryFailure } from '@/lib/hermes/api';
import { serviceClient } from '@/lib/supabase/admin';
import { COMMERCIAL_SYSTEM } from '@/lib/commercial/v6/prompt';

export const dynamic='force-dynamic';
export async function POST(request:Request){
 const auth=await authenticate(request,'mensagens:escrever');
 if('response' in auth)return auth.response;
 const {data,error}=await serviceClient().rpc('api_commercial_v6_contexts',{p_token:auth.tokenId});
 if(error||!data)return temporaryFailure();
 return json({...data,system:data.status==='v4'?undefined:COMMERCIAL_SYSTEM});
}
