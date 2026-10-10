export const TZ = "America/Sao_Paulo";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const fmtDate = (v: string | Date | null | undefined) => (v ? dateFmt.format(new Date(v)) : "—");
export const fmtDateTime = (v: string | Date | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : "—");
export const fmtMoney = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : money.format(Number(v));
export const fmtPercent = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "—" : `${(Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todaySP(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: TZ });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PeriodKey = "hoje" | "semana" | "mes" | "personalizado";

/** Intervalo inclusivo de datas no fuso de São Paulo. Semana começa na segunda. */
export function periodRange(key: PeriodKey, now = new Date(), custom?: { start?: string; end?: string }) {
  const today = todaySP(now);
  if (key === "semana") {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const offset = (weekday + 6) % 7;
    return { start: addDays(today, -offset), end: today };
  }
  if (key === "mes") {
    return { start: `${today.slice(0, 8)}01`, end: today };
  }
  if (key === "personalizado" && custom?.start && custom?.end && /^\d{4}-\d{2}-\d{2}$/.test(custom.start) && /^\d{4}-\d{2}-\d{2}$/.test(custom.end)) {
    return custom.start <= custom.end ? { start: custom.start, end: custom.end } : { start: custom.end, end: custom.start };
  }
  return { start: today, end: today };
}

/** Converte "AAAA-MM-DDTHH:mm" digitado no fuso de São Paulo para ISO UTC. */
export function spLocalToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("data/hora inválida");
  // São Paulo não tem horário de verão desde 2019: UTC-3 fixo.
  return new Date(`${local}:00-03:00`).toISOString();
}

/** ISO UTC para "AAAA-MM-DDTHH:mm" no fuso de São Paulo (valor de input datetime-local). */
export function isoToSpLocal(iso: string | Date): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return parts.replace(" ", "T");
}

/** "há 5 min", "há 2 h", "há 3 dias" a partir de um instante até agora. */
export function haQuanto(v: string | Date | null | undefined, now = new Date()): string {
  if (!v) return "";
  const min = Math.max(0, Math.floor((now.getTime() - new Date(v).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}
