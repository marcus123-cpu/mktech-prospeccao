import QRCode from "qrcode";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { fmtDateTime, haQuanto } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conexão" };

type Conn = { ready: boolean; phone_number: string | null; state: string | null; qr: string | null; qr_at: string | null; connected_since: string | null; updated_at: string };
const STALE_MS = 3 * 60 * 1000;

export default async function ConexaoPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_whatsapp_connection");
  if (error) return <><PageHeader title="Conexão" /><ErrorBox message="Não foi possível carregar. Aplique a migração 20261015180000_conexao_whatsapp.sql no Supabase." /></>;
  const c = data as Conn;
  const stale = Date.now() - new Date(c.updated_at).getTime() > STALE_MS;
  const status = stale ? "offline" : c.ready ? "conectado" : "desconectado";
  const svg = status === "desconectado" && c.qr ? await QRCode.toString(c.qr, { type: "svg", margin: 1, width: 280, color: { dark: "#000000", light: "#ffffff" } }) : null;
  const number = c.phone_number ? `+${c.phone_number}` : null;

  return <>
    <AutoRefresh />
    <PageHeader title="🔌 Conexão" subtitle="O WhatsApp que o Hermes usa para mandar as saudações." />
    <section className="card mx-auto max-w-xl p-6 text-center">
      {status === "conectado" && <>
        <p className="text-5xl">✅</p>
        <h2 className="mt-2 text-xl font-semibold text-emerald-300">WhatsApp conectado</h2>
        {number && <p className="mt-1 text-sm text-muted">Número {number}</p>}
        {c.connected_since && <p className="text-xs text-muted">conectado desde {fmtDateTime(c.connected_since)}</p>}
        <p className="mt-4 text-sm text-muted">Tudo certo: as saudações saem pelo horário e limite do Disparar.</p>
      </>}
      {status === "desconectado" && <>
        <p className="text-5xl">📵</p>
        <h2 className="mt-2 text-xl font-semibold text-amber-300">WhatsApp desconectado</h2>
        {svg ? <>
          <div className="mx-auto mt-4 w-fit rounded-xl bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code para conectar o WhatsApp" />
          <ol className="mx-auto mt-4 max-w-sm list-decimal space-y-1 pl-5 text-left text-sm text-muted">
            <li>No celular do chip, abra o WhatsApp.</li>
            <li>Toque em <b>Aparelhos conectados</b> e depois em <b>Conectar um aparelho</b>.</li>
            <li>Aponte a câmera para este QR code.</li>
          </ol>
          <p className="mt-3 text-xs text-muted">O código muda sozinho e esta tela atualiza. {c.qr_at && `Gerado ${haQuanto(c.qr_at)}.`}</p>
        </> : <p className="mt-3 text-sm text-muted">Aguardando o QR code da ponte{c.state ? ` (${c.state})` : ""}. Se demorar, confira se a ponte do WhatsApp está aberta no PC.</p>}
      </>}
      {status === "offline" && <>
        <p className="text-5xl">💤</p>
        <h2 className="mt-2 text-xl font-semibold text-rose-300">Sem sinal do PC</h2>
        <p className="mt-2 text-sm text-muted">Última notícia da ponte {haQuanto(c.updated_at)}. Abra o <b>painel-auto.bat</b> (ou a ponte e o enviador) no computador; o QR code aparece aqui quando ela voltar.</p>
      </>}
    </section>
    <p className="mx-auto mt-4 max-w-xl text-center text-xs text-muted">Só você, logado no painel, vê este QR code. Quem escanear conecta o chip: não compartilhe a tela.</p>
  </>;
}
