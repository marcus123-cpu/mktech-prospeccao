import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const { supabase } = await requireAdmin();
  const results = await Promise.all([
    supabase.from("outreach_replies").select("id,received_at").order("received_at", {ascending:false}).limit(1),
    supabase.from("outreach_outbound").select("id,sent_at").order("sent_at", {ascending:false}).limit(1),
    supabase.from("whatsapp_receipts").select("external_id,ack,updated_at").order("updated_at", {ascending:false}).limit(1),
    supabase.from("manual_outbox").select("id,status,provider_id").order("created_at", {ascending:false}).limit(15),
    supabase.from("chat_audio").select("external_id,created_at").order("created_at", {ascending:false}).limit(1),
    supabase.from("whatsapp_history").select("external_id,occurred_at", {count:"exact"}).order("occurred_at", {ascending:false}).limit(1),
    // Lida / não lida marcada à mão: a lista precisa refletir na hora.
    supabase.from("conversation_reads").select("lead_id,seen_at,marked_unread,updated_at").order("updated_at", {ascending:false}).limit(1),
  ]);
  if (results.some(r => r.error)) return new NextResponse(null, {status:503});
  return NextResponse.json(results.map(r => ({ data:r.data, count:r.count })), { headers: {"Cache-Control":"no-store"} });
}
