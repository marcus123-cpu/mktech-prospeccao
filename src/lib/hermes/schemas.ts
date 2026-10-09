import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional().nullable();
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\//i, "use uma URL http(s)");

export const evidenceSchema = z
  .object({
    kind: z.enum(["site", "instagram", "google", "whatsapp", "diretorio", "busca", "outro"]),
    url: httpUrl.optional().nullable(),
    summary: text(2000).min(1),
    observed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional().nullable(),
    limitation: optText(1000),
  })
  .strict();

// Campos que o Hermes pode enviar. Etapa, contatos, valores e observações
// manuais NÃO fazem parte do contrato: chaves desconhecidas são recusadas.
export const candidateSchema = z
  .object({
    business_name: text(200).min(1),
    responsible_name: optText(200),
    niche: optText(200),
    services: z.array(text(100)).max(30).optional(),
    city: text(120).min(1),
    state: z.string().regex(/^[A-Z]{2}$/).optional(),
    neighborhood: optText(120),
    unit_label: optText(120),
    phone: optText(40),
    instagram: optText(200),
    whatsapp_url: httpUrl.optional().nullable(),
    website_url: optText(2000),
    source_name: optText(60),
    source_place_id: optText(300),
    research_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    selection_reason: text(2000).min(1),
    pending_items: optText(2000),
    priority: z.enum(["alta", "media", "baixa"]).optional(),
    site_status: z
      .enum(["site_proprio_encontrado", "site_nao_localizado", "apenas_redes_sociais", "verificacao_pendente"])
      .optional(),
    evidences: z.array(evidenceSchema).min(1).max(20),
  })
  .strict();

export const registerSchema = z
  .object({
    run_id: z.uuid().optional().nullable(),
    candidate: candidateSchema,
  })
  .strict();

export const checkSchema = z
  .object({
    business_name: text(200).min(1),
    city: text(120).min(1),
    state: z.string().regex(/^[A-Z]{2}$/).optional(),
    unit_label: optText(120),
    phone: optText(40),
    instagram: optText(200),
    website_url: optText(2000),
    source_name: optText(60),
    source_place_id: optText(300),
  })
  .strict();

export const startRunSchema = z
  .object({
    routine: z.string().regex(/^[a-z0-9-]{3,60}$/).default("prospeccao-diaria"),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const finishRunSchema = z
  .object({
    status: z.enum(["concluida", "parcial", "falhou"]),
    searched: z.number().int().min(0).max(100000),
    approved: z.number().int().min(0).max(100000),
    discarded: z.number().int().min(0).max(100000),
    errors: z.number().int().min(0).max(100000),
    error_details: z.array(z.string().max(500)).max(50).optional(),
    end_reason: text(500).min(1),
    notes: optText(4000),
  })
  .strict();

/** Remove nulos para o banco tratar campos ausentes de forma uniforme. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}
