import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { serviceClient } from "@/lib/supabase/admin";

export type Scope =
  | "duplicados:ler"
  | "candidatos:criar"
  | "execucoes:registrar"
  | "config:ler"
  | "mensagens:escrever"
  | "envio:operar";

const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = 240; // requisições por minuto, por token
const TOKEN_TTL_MS = 15_000; // cache curto da checagem do token: revogação vale em até 15 s
const tokenCache = new Map<string, { tokenId: string; expiresAt: number }>();
const buckets = new Map<string, { count: number; resetAt: number }>();

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export const temporaryFailure = () =>
  json({ status: "falha_temporaria", errors: ["falha temporária; tente novamente"] }, 503, { "Retry-After": "5" });

function rateLimited(key: string): number | null {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  b.count += 1;
  return b.count > RATE_LIMIT ? Math.ceil((b.resetAt - now) / 1000) : null;
}

/**
 * Autentica o token do Hermes (Authorization: Bearer mkt_...). O banco só
 * guarda o hash; um token revogado ou sem o escopo pedido é recusado.
 */
export async function authenticate(
  request: Request,
  scope: Scope,
): Promise<{ tokenId: string } | { response: NextResponse }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(mkt_[a-f0-9]{64})$/i.exec(header.trim());
  if (!match) {
    return { response: json({ status: "nao_autorizado", errors: ["token ausente ou malformado"] }, 401) };
  }
  const hash = createHash("sha256").update(match[1], "utf8").digest("hex");
  const retry = rateLimited(hash);
  if (retry !== null) {
    return {
      response: json({ status: "limite_excedido", errors: ["muitas requisições"] }, 429, { "Retry-After": String(retry) }),
    };
  }
  const cacheKey = `${hash}:${scope}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() && process.env.NODE_ENV !== "test") return { tokenId: hit.tokenId };
  try {
    const { data, error } = await serviceClient().rpc("api_token_check", { p_hash: hash, p_scope: scope });
    if (error) return { response: temporaryFailure() };
    if (!data) {
      tokenCache.delete(cacheKey);
      return { response: json({ status: "nao_autorizado", errors: ["token inválido, revogado ou sem permissão"] }, 403) };
    }
    if (tokenCache.size > 200) tokenCache.clear();
    tokenCache.set(cacheKey, { tokenId: data as string, expiresAt: Date.now() + TOKEN_TTL_MS });
    return { tokenId: data as string };
  } catch {
    return { response: temporaryFailure() };
  }
}

export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return { response: json({ status: "invalido", errors: ["corpo muito grande"] }, 413) };
  }
  let raw: unknown;
  try {
    const textBody = await request.text();
    if (textBody.length > MAX_BODY_BYTES) {
      return { response: json({ status: "invalido", errors: ["corpo muito grande"] }, 413) };
    }
    raw = textBody ? JSON.parse(textBody) : {};
  } catch {
    return { response: json({ status: "invalido", errors: ["JSON inválido"] }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`);
    return { response: json({ status: "invalido", errors }, 422) };
  }
  return { data: parsed.data };
}

const STATUS_HTTP: Record<string, number> = {
  criado: 201,
  existente: 200,
  possivel_duplicado: 202,
  novo: 200,
  invalido: 422,
  limite_atingido: 409,
  iniciada: 201,
  ja_em_andamento: 409,
  encerrada: 200,
  ja_encerrada: 409,
  registrado: 200,
  registrada: 201,
  ignorada: 200,
  criada: 201,
  passada: 200,
  desatualizada: 409,
  sem_conversa: 409,
  desligado: 409,
  sem_pedido: 409,
  nenhum: 200,
  pendente: 200,
  retomar: 200,
  retomada: 200,
  gravada: 201,
};

/** Converte o resultado jsonb de uma função api_* em resposta HTTP. */
export function fromDb(result: { status?: string } | null) {
  if (!result || typeof result.status !== "string") return temporaryFailure();
  return json(result, STATUS_HTTP[result.status] ?? 200);
}
