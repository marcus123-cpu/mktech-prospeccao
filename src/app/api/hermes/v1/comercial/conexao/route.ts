import { z } from "zod";
import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";
export const dynamic="force-dynamic";
const schema=z.object({ready:z.boolean(),number:z.string().max(30).nullish(),state:z.string().max(120).nullish(),qr:z.string().max(1000).nullish(),demonstrations:z.array(z.object({id:z.string().max(100),available:z.boolean()}).strict()).max(100).optional()}).strict();
export async function POST(request:Request){
  const auth=await authenticate(request,"envio:operar");if("response" in auth)return auth.response;
  const body=await parseBody(request,schema);if("response" in body)return body.response;
  const {data,error}=await serviceClient().rpc("api_commercial_health",{p_token:auth.tokenId,p_ready:body.data.ready});
  if(!error && body.data.demonstrations){const verified=await serviceClient().rpc("api_commercial_demo_health",{p_token:auth.tokenId,p_items:body.data.demonstrations,p_ready:body.data.ready});if(verified.error)return temporaryFailure();}
  // Estado da conexão para a aba Conexão do painel (QR só enquanto desconectado).
  await serviceClient().rpc("api_whatsapp_connection_set",{p_ready:body.data.ready,p_number:body.data.number??null,p_state:body.data.state??null,p_qr:body.data.ready?null:(body.data.qr??null)});
  return error ? temporaryFailure() : fromDb(data);
}
