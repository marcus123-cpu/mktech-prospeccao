import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAdmin} from "@/lib/auth";
export const dynamic="force-dynamic";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}) {
  const {supabase}=await requireAdmin();
  const id=z.uuid().safeParse((await params).id);
  if(!id.success)return new NextResponse(null,{status:404});
  const [memory,diagnosis]=await Promise.all([
    supabase.from("lead_conversation_memory").select("summary,facts,objections,next_action,updated_at").eq("lead_id",id.data).maybeSingle(),
    supabase.from("lead_diagnoses").select("*").eq("lead_id",id.data).order("created_at",{ascending:false}).limit(1),
  ]);
  if(memory.error||diagnosis.error)return new NextResponse(null,{status:503});
  return NextResponse.json({memory:memory.data,diagnosis:diagnosis.data?.[0]??null},{headers:{"Cache-Control":"no-store"}});
}
