import { z } from "zod";

export const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;
export const UF_NAME: Record<(typeof UFS)[number], string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco",
  PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** Valores iniciais de toda nova pesquisa: nada é herdado de pesquisas anteriores nem de geolocalização. */
export const RESEARCH_DEFAULTS = { niche: "Academia", scope: "brasil", target: 100 } as const;
export const MAX_TARGET = 1000;

const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
export const researchSchema = z
  .object({
    observations: z.string().trim().max(3000, "OBS com até 3000 caracteres.").default(""),
    niche: z.string().trim().min(2, "Informe o nicho.").max(100, "Nicho com até 100 caracteres."),
    scope: z.enum(["brasil", "estado", "cidade"]),
    state: z.preprocess(empty, z.enum(UFS).optional()),
    city: z.preprocess(empty, z.string().trim().min(2).max(120).optional()),
    target: z.coerce.number().int("Use um número inteiro.").min(1, "A quantidade deve ser positiva.").max(MAX_TARGET, `No máximo ${MAX_TARGET} leads por pesquisa.`),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "estado" && !v.state) ctx.addIssue({ code: "custom", path: ["state"], message: "Escolha o estado." });
    if (v.scope === "cidade" && !v.state) ctx.addIssue({ code: "custom", path: ["state"], message: "Informe o estado da cidade." });
    if (v.scope === "cidade" && !v.city) ctx.addIssue({ code: "custom", path: ["city"], message: "Informe a cidade." });
  })
  .transform((v) => ({ ...v, state: v.scope === "brasil" ? undefined : v.state, city: v.scope === "cidade" ? v.city : undefined }));
export type ResearchInput = z.output<typeof researchSchema>;

export function locationLabel(r: { location_scope: string; location_state?: string | null; location_city?: string | null }): string {
  if (r.location_scope === "cidade") return `${r.location_city}/${r.location_state}`;
  if (r.location_scope === "estado") return UF_NAME[r.location_state as keyof typeof UF_NAME] ?? String(r.location_state);
  return "Brasil inteiro";
}
