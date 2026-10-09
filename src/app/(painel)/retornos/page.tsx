import Link from "next/link";
import { Empty, ErrorBox, PageHeader, StageBadge } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import type { Stage } from "@/lib/labels";
import { whatsappLink } from "@/lib/leads-query";
import { fmtDateTime, todaySP } from "@/lib/time";

export const metadata = { title: "Retornos" };

type Row = {
  id: string;
  business_name: string;
  city: string;
  stage: Stage;
  next_follow_up_at: string;
  phone_e164: string | null;
  whatsapp_url: string | null;
};

export default async function FollowUps() {
  const { supabase } = await requireAdmin();
  const today = todaySP();
  const startToday = new Date(`${today}T00:00:00-03:00`).toISOString();
  const startTomorrow = new Date(new Date(startToday).getTime() + 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("leads")
    .select("id, business_name, city, stage, next_follow_up_at, phone_e164, whatsapp_url")
    .not("next_follow_up_at", "is", null)
    .not("stage", "in", "(fechado,sem_interesse,desqualificado)")
    .order("next_follow_up_at", { ascending: true })
    .limit(500);
  const rows = (data ?? []) as Row[];
  const groups = [
    { title: "Vencidos", rows: rows.filter((r) => r.next_follow_up_at < startToday), tone: "text-rose-300" },
    { title: "Hoje", rows: rows.filter((r) => r.next_follow_up_at >= startToday && r.next_follow_up_at < startTomorrow), tone: "text-amber-300" },
    { title: "Próximos", rows: rows.filter((r) => r.next_follow_up_at >= startTomorrow), tone: "text-slate-200" },
  ];

  return (
    <>
      <PageHeader title="Retornos" subtitle="Quem você combinou de chamar de novo. Os atrasados aparecem primeiro." />
      {error ? (
        <ErrorBox message={dbErrorMessage(error)} />
      ) : rows.length === 0 ? (
        <Empty title="Nenhum retorno agendado.">Agende retornos na ficha de cada lead.</Empty>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className={`mb-2 text-sm font-semibold ${g.tone}`}>
                {g.title} ({g.rows.length})
              </h2>
              {g.rows.length === 0 ? (
                <p className="text-sm text-muted">Nada aqui.</p>
              ) : (
                <ul className="card divide-y divide-line">
                  {g.rows.map((r) => {
                    const wa = whatsappLink(r);
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <div>
                          <Link href={`/leads/${r.id}`} className="font-medium hover:text-accent">{r.business_name}</Link>
                          <div className="text-xs text-muted">{r.city} · {fmtDateTime(r.next_follow_up_at)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StageBadge stage={r.stage} />
                          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-ghost">WhatsApp</a>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
