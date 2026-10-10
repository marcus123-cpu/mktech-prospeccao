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

export const OFFERS = [
  "landing_page",
  "landing_por_procedimento",
  "site_institucional",
  "site_com_agendamento",
  "nao_recomendado",
] as const;

// Diagnóstico comercial: material para o Marcos decidir e abordar.
export const diagnosisSchema = z
  .object({
    fit_score: z.number().int().min(0).max(100),
    confidence: z.enum(["baixa", "media", "alta"]),
    summary: text(2000).min(1),
    audience: optText(1000),
    digital_presence: optText(2000),
    pains: z
      .array(z.object({ pain: text(300).min(1), evidence: text(500).min(1) }).strict())
      .max(8),
    opportunities: z.array(text(300).min(1)).max(8).optional(),
    offer: z.enum(OFFERS),
    offer_reason: text(2000).min(1),
    approach: optText(2000),
    objections: z.array(text(300).min(1)).max(6).optional(),
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
    diagnosis: diagnosisSchema.optional(),
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

// Envio automático: mensagem que o Hermes escreve a partir do diagnóstico.
// A saudação (bom dia / boa noite) não entra aqui: o servidor manda antes.
export const outreachSchema = z
  .object({
    elogio: text(300).min(1),
    dor: text(300).min(1),
    melhoria: text(300).min(1),
    mensagem: text(700).min(1),
  })
  .strict();

// Enviador: resultado de uma etapa.
export const outreachResultSchema = z
  .object({
    etapa: z.enum(["saudacao", "mensagem", "lembrete"]),
    ok: z.boolean(),
    erro: optText(500),
  })
  .strict();

// Enviador: mensagem que o Marcos escreveu à mão no celular do chip (só o horário é guardado).
export const outreachOutboundSchema = z
  .object({
    telefone: text(30).regex(/^\+?[0-9 ()-]{10,25}$/, "telefone inválido"),
    enviada_em: z.string().regex(/^\d{4}-\d{2}-\d{2}T/).optional().nullable(),
  })
  .strict();

// Enviador: mensagem recebida de um telefone abordado.
export const outreachReplySchema = z
  .object({
    telefone: text(30).regex(/^\+?[0-9 ()-]{10,25}$/, "telefone inválido"),
    tipo: z.enum(["texto", "audio", "imagem", "outro"]).default("texto"),
    texto: text(4000).optional().nullable(),
    recebida_em: z.string().regex(/^\d{4}-\d{2}-\d{2}T/).optional().nullable(),
    segundos_desde_envio: z.number().min(0).max(86400 * 30).optional().nullable(),
    anteriores: z.array(text(4000)).max(20).optional(),
  })
  .strict()
  .refine((r) => r.tipo !== "texto" || !!r.texto, { message: "texto obrigatório", path: ["texto"] });
