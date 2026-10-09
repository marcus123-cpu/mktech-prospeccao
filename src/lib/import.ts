// Conversão das linhas da planilha para o formato aceito por admin_import_rows.
// Funções puras, testadas em tests/unit/import.test.ts.

export const TARGET_FIELDS = [
  { key: "business_name", label: "Cliente / nome comercial", required: true, hints: ["cliente", "nome", "clinica", "empresa", "estabelecimento"] },
  { key: "phone", label: "Telefone / WhatsApp", required: false, hints: ["telefone", "whatsapp", "celular", "fone", "contato"] },
  { key: "contacted", label: "Contatado?", required: false, hints: ["contatado", "contactado", "contato feito"] },
  { key: "city", label: "Cidade", required: true, hints: ["cidade", "municipio"] },
  { key: "instagram", label: "Instagram", required: false, hints: ["instagram", "insta", "ig"] },
  { key: "whatsapp_url", label: "Link do WhatsApp", required: false, hints: ["link do whatsapp", "link whatsapp", "wa.me", "link"] },
  { key: "site_check", label: "Verificação de site", required: false, hints: ["verificacao de site", "site", "verificacao"] },
  { key: "notes", label: "Observações", required: false, hints: ["observacao", "observacoes", "obs", "nota", "notas"] },
] as const;

export type TargetKey = (typeof TARGET_FIELDS)[number]["key"];
export type Mapping = Partial<Record<TargetKey, number>>;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Sugere o mapeamento pelas colunas conhecidas da planilha. */
export function guessMapping(headers: string[]): Mapping {
  const used = new Set<number>();
  const mapping: Mapping = {};
  const normalized = headers.map(norm);
  // Primeiro correspondências exatas, depois parciais, para "Link do WhatsApp" não roubar "Telefone / WhatsApp".
  for (const pass of ["exact", "partial"] as const) {
    for (const field of TARGET_FIELDS) {
      if (mapping[field.key] !== undefined) continue;
      const idx = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          field.hints.some((hint) => (pass === "exact" ? h === norm(hint) || h === norm(field.label) : h.includes(norm(hint)))),
      );
      if (idx >= 0) {
        mapping[field.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

/** "Sim" = contato realizado, "Não" = não contatado, vazio/outro = desconhecido. */
export function parseContacted(v: string): "sim" | "nao" | null {
  const n = norm(v);
  if (["sim", "s", "yes", "x", "contatado", "ok"].includes(n)) return "sim";
  if (["nao", "n", "no", "nao contatado"].includes(n)) return "nao";
  return null;
}

/**
 * Situação do site a partir do texto livre da planilha. Nunca transforma
 * texto desconhecido em "não tem site": na dúvida, fica pendente.
 */
export function parseSiteCheck(v: string): { status: string; website_url?: string } {
  const raw = v.trim();
  const n = norm(raw);
  if (!n) return { status: "verificacao_pendente" };
  const url = raw.match(/https?:\/\/\S+|(?:www\.)?[a-z0-9-]+\.(?:com\.br|com|net|med\.br|site|online)(?:\/\S*)?/i)?.[0];
  if (/(linktr|linkin|bio\.site|beacons|taplink|so (rede|insta)|apenas (rede|insta)|somente (rede|insta)|instagram|rede social)/.test(n)) {
    return { status: "apenas_redes_sociais" };
  }
  if (/(nao (tem|possui|encontr|localiz|achei)|sem site|nenhum site|inexistente)/.test(n)) {
    return { status: "site_nao_localizado" };
  }
  if (url) return { status: "site_proprio_encontrado", website_url: url };
  if (/(tem site|possui site|site proprio|com site)/.test(n)) return { status: "site_proprio_encontrado" };
  return { status: "verificacao_pendente" };
}

const DISQUALIFY = /(nao atua mais|parou de atuar|nao trabalha mais|nao faz mais|mudou de (area|ramo)|encerrou|fechou a clinica|fora do nicho|nao e mais)/;

export function disqualifyReason(...texts: string[]): string | null {
  for (const t of texts) {
    if (t && DISQUALIFY.test(norm(t))) return t.trim().slice(0, 500);
  }
  return null;
}

export type ImportRow = Record<string, string | null>;

export function buildRows(rows: string[][], mapping: Mapping, defaultCity = ""): ImportRow[] {
  const get = (row: string[], key: TargetKey) => {
    const idx = mapping[key];
    return idx === undefined ? "" : String(row[idx] ?? "").trim();
  };
  return rows
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const site = parseSiteCheck(get(r, "site_check"));
      const siteText = get(r, "site_check");
      const notesText = get(r, "notes");
      const notes = [notesText, site.status === "verificacao_pendente" && siteText ? `Verificação de site (planilha): ${siteText}` : ""]
        .filter(Boolean)
        .join("\n");
      const out: ImportRow = {
        business_name: get(r, "business_name"),
        city: get(r, "city") || defaultCity,
        state: "SP",
        phone: get(r, "phone") || null,
        instagram: get(r, "instagram") || null,
        whatsapp_url: /^https?:\/\//i.test(get(r, "whatsapp_url")) ? get(r, "whatsapp_url") : null,
        site_status: site.status,
        website_url: site.website_url ?? null,
        contacted: parseContacted(get(r, "contacted")),
        notes: notes || null,
        disqualify_reason: disqualifyReason(notesText, siteText),
      };
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== "")) as ImportRow;
    });
}

/** CSV de exportação: telefones e textos entre aspas para não perder dígitos nem acentos. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Evita que planilhas executem fórmulas vindas de dados de terceiros.
    const isPhone = /^\+?[\d\s().-]+$/.test(s);
    const safe = !isPhone && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}
