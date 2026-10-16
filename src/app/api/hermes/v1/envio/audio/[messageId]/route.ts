import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/webm": "webm", "audio/wav": "wav", "audio/amr": "amr",
};

// PUT /api/hermes/v1/envio/audio/{messageId} — o enviador guarda o áudio de uma
// conversa (corpo = bytes do arquivo). Idempotente: o mesmo ID sobrescreve.
export async function PUT(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const { messageId: raw } = await params;
  const messageId = decodeURIComponent(raw);
  if (!messageId || messageId.length > 200) return json({ status: "invalido", errors: ["id inválido"] }, 422);
  const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return json({ status: "invalido", errors: ["tipo de áudio não aceito"] }, 415);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_AUDIO_BYTES) return json({ status: "invalido", errors: ["áudio grande demais"] }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) return json({ status: "invalido", errors: ["áudio vazio ou grande demais"] }, 413);

  const path = `${Buffer.from(messageId, "utf8").toString("hex").slice(0, 160)}.${ext}`;
  const db = serviceClient();
  const up = await db.storage.from("chat-audio").upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) return temporaryFailure();
  const { error } = await db.from("chat_audio").upsert({ external_id: messageId, storage_path: path, mime, bytes: bytes.length });
  if (error) return temporaryFailure();
  return json({ status: "registrado" }, 201);
}
