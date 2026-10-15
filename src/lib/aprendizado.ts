import { z } from "zod";

/** Seções fixas do aprendizado.md: o Hermes só acrescenta regras dentro delas. */
export const SECTIONS = [
  "Saudação e abertura",
  "Como chama o lead (nome)",
  "Como desenrola o atendimento",
  "Respostas automáticas (robô de clínica)",
  "Objeções e preço",
  "Áudios (voz gerada por IA)",
  "Atenção especial a um lead",
  "Encaminhamento e fechamento",
  "Tom e vocabulário",
  "O que evitar",
] as const;

export const additionSchema = z.object({
  section: z.enum(SECTIONS),
  rule: z.string().trim().min(8).max(260),
  example: z.string().trim().max(240).optional().nullable(),
}).strict();
export type Addition = z.infer<typeof additionSchema>;

const MAX_PER_SECTION = 30;
const HEADER = "# aprendizado.md — como o Marcos trabalha no WhatsApp\n\nAnotado pelo Hermes ao observar o trabalho dele. Só observação: nada aqui envia mensagem.\n";

export function parsePlaybook(md: string): Map<string, string[]> {
  const map = new Map<string, string[]>(SECTIONS.map((s) => [s, []]));
  let current: string | null = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { current = map.has(h[1]) ? h[1] : null; continue; }
    if (current && /^-\s+/.test(line)) map.get(current)!.push(line.replace(/^-\s+/, "").trim());
  }
  return map;
}

export function renderPlaybook(map: Map<string, string[]>): string {
  const parts = [HEADER];
  for (const section of SECTIONS) {
    const rules = map.get(section) ?? [];
    parts.push(`\n## ${section}\n${rules.length ? rules.map((r) => `- ${r}`).join("\n") : "_(ainda sem anotações)_"}\n`);
  }
  return parts.join("");
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Junta as novas regras do dia ao aprendizado.md, sem repetir e com teto por seção. */
export function mergePlaybook(current: string, additions: Addition[]): { markdown: string; added: number } {
  const map = parsePlaybook(current);
  let added = 0;
  for (const a of additions) {
    const rules = map.get(a.section)!;
    const text = a.example ? `${a.rule} Ex.: “${a.example.replace(/\s+/g, " ")}”` : a.rule;
    if (rules.some((r) => norm(r) === norm(text) || norm(r).startsWith(norm(a.rule).slice(0, 60)))) continue;
    if (rules.length >= MAX_PER_SECTION) rules.shift();
    rules.push(text);
    added++;
  }
  return { markdown: renderPlaybook(map), added };
}

/** Dia 1 = dia em que o aprendizado começou. */
export function dayNumber(startedOn: string | null, today: string): number {
  if (!startedOn) return 0;
  return Math.floor((Date.parse(today) - Date.parse(startedOn)) / 86400000) + 1;
}
