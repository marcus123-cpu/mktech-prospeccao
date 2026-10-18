import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { z } from "zod";
export async function GET(_: Request, { params }: { params: Promise<{id: string}> }) {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const { data: file } = await supabase.from("chat_attachments").select("storage_path,filename").eq("id", id.data).maybeSingle();
  if (!file) return new NextResponse(null, { status: 404 });
  const { data, error } = await serviceClient().storage.from("chat-attachments").createSignedUrl(file.storage_path, 300, { download: file.filename });
  return error || !data ? new NextResponse(null, { status: 503 }) : NextResponse.redirect(data.signedUrl, 302);
}
