import { beforeEach, describe, expect, it, vi } from "vitest";

// Banco simulado: confere a estratégia sugerida, a validação e o que vai para o banco.
const rpc = vi.fn();
const tables: Record<string, unknown> = {};
const from = (table: string) => {
  const q = {
    select: () => q,
    eq: () => q,
    neq: () => q,
    maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
  };
  return q;
};
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc, from }) }));

const { GET: pending } = await import("@/app/api/hermes/v1/envio/pendentes/route");
const { POST: saveMessage } = await import("@/app/api/hermes/v1/envio/mensagens/[leadId]/route");
const { POST: postReply } = await import("@/app/api/hermes/v1/envio/respostas/route");
const { POST: secretary } = await import("@/app/api/hermes/v1/secretario/[leadId]/route");

const TOKEN = "mkt_" + "e".repeat(64);
const LEAD = "22222222-2222-4222-8222-222222222222";
const rico = {
  id: LEAD,
  business_name: "Studio Lírio",
  city: "Bauru",
  site_status: "site_nao_localizado",
  diagnosis: {
    confidence: "media",
    summary: "Estúdio de estética facial.",
    digital_presence: "Instagram com posts semanais de limpeza de pele.",
    pains: [{ pain: "Agendamento só pelo WhatsApp", evidence: "Bio do Instagram" }],
    opportunities: ["Página com agendamento"],
  },
  evidences: [
    { kind: "instagram", summary: "Posts semanais de limpeza de pele no Instagram" },
    { kind: "google", summary: "Perfil no Google com telefone" },
  ],
};
const pobre = { ...rico, diagnosis: { ...rico.diagnosis, confidence: "baixa", digital_presence: "Só diretório." }, evidences: [{ kind: "diretorio", summary: "Diretório com telefone" }] };
let ctx: object = rico;
const good = {
  elogio: "posts semanais de limpeza de pele no Instagram",
  dor: "agendamento só pelo WhatsApp",
  melhoria: "página com agendamento",
  mensagem:
    "Me chamo Marcos, sou desenvolvedor. Estava conhecendo o Instagram de vocês e vi os posts semanais de limpeza de pele. Queria saber uma coisa: hoje vocês têm alguma página própria para apresentar os procedimentos ou usam mais o Instagram?",
  estrategia: "B",
};

const req = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = <T>(v: T) => ({ params: Promise.resolve(v) });

beforeEach(() => {
  rpc.mockReset();
  ctx = rico;
  for (const k of Object.keys(tables)) delete tables[k];
  rpc.mockImplementation(async (fn: string, args: Record<string, any>) => {
    if (fn === "api_token_check") return { data: "tok", error: null };
    if (fn === "api_outreach_pending") return { data: { status: "ok", leads: [rico, rico, rico, pobre] }, error: null };
    if (fn === "api_outreach_strategy_counts") return { data: [], error: null };
    if (fn === "api_outreach_context") return { data: ctx, error: null };
    if (fn === "api_outreach_note_failure") return { data: { falhas: 1 }, error: null };
    if (fn === "api_outreach_save") return { data: { status: "criado", message_id: "m1", estrategia: args.p.estrategia }, error: null };
    if (fn === "api_outreach_reply") return { data: { status: "registrada", reply_id: "r1", lead_id: LEAD, kind: args.p.kind }, error: null };
    if (fn === "api_reply_annotate") return { data: { status: "ok" }, error: null };
    if (fn === "api_secretary_save") return { data: { status: "criada" }, error: null };
    if (fn === "api_commercial_update") return { data: { status: "ok" }, error: null };
    return { data: null, error: { message: "inesperado" } };
  });
});

describe("estratégias nas rotas do Hermes", () => {
  it("envio-pendentes traz a estratégia de cada lead, equilibrando o teste", async () => {
    const res = await pending(req("/api/hermes/v1/envio/pendentes?limit=4"));
    expect(res.status).toBeLessThan(300);
    const leads = (await res.json()).leads;
    expect(leads.slice(0, 3).map((l: any) => l.estrategia.letra).sort()).toEqual(["A", "B", "C"]);
    expect(leads[0].estrategia).toMatchObject({ modo: "teste", referencia: expect.stringContaining("Marcos") });
    // Lead sem dados públicos nunca recebe a consultiva.
    expect(leads[3].estrategia.letra).not.toBe("B");
    expect(leads[3].estrategia.nao_usar.B).toBeTruthy();
  });

  it("grava a estratégia com o estrato e o modo do teste", async () => {
    const res = await saveMessage(req(`/api/hermes/v1/envio/mensagens/${LEAD}`, good), params({ leadId: LEAD }));
    expect(res.status).toBeLessThan(300);
    const call = rpc.mock.calls.find(([fn]) => fn === "api_outreach_save")!;
    expect(call[1].p).toMatchObject({ estrategia: "B", estrato: "ricos-instagram", modo_estrategia: "teste" });
  });

  it("recusa a consultiva para lead sem dados públicos e conta a recusa", async () => {
    ctx = pobre;
    const res = await saveMessage(req(`/api/hermes/v1/envio/mensagens/${LEAD}`, good), params({ leadId: LEAD }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors.join(" ")).toMatch(/Estratégia B não serve/);
    expect(rpc.mock.calls.some(([fn]) => fn === "api_outreach_save")).toBe(false);
    expect(rpc.mock.calls.some(([fn]) => fn === "api_outreach_note_failure")).toBe(true);
  });

  it("resposta da recepção é anotada com intenção, papel e próximo estado", async () => {
    tables.leads = { conversation_state: "primeiro_contato", contact_role: null, video_offered_at: null, video_sent_at: null };
    tables.outreach_messages = { strategy: "A", sent_at: null };
    const res = await postReply(req("/api/hermes/v1/envio/respostas", { telefone: "+5517991234567", texto: "Sou a recepcionista, do que se trata?" }));
    expect(res.status).toBeLessThan(300);
    const call = rpc.mock.calls.find(([fn]) => fn === "api_reply_annotate")!;
    expect(call[1]).toMatchObject({ p_reply: "r1", p: { intencao: "esclarecimento", papel: "recepcionista", estado: "resposta_recebida" } });
  });

  it("aceite depois da estratégia A conta como vídeo autorizado", async () => {
    tables.leads = { conversation_state: "resposta_recebida", contact_role: "proprietaria", video_offered_at: null, video_sent_at: null };
    tables.outreach_messages = { strategy: "A", sent_at: "2026-10-13T12:00:00Z" };
    await postReply(req("/api/hermes/v1/envio/respostas", { telefone: "+5517991234567", texto: "Pode sim" }));
    const call = rpc.mock.calls.find(([fn]) => fn === "api_reply_annotate")!;
    expect(call[1].p).toMatchObject({ intencao: "positiva", estado: "video", video: "autorizado" });
  });

  it("secretário registra o que percebeu da conversa", async () => {
    const res = await secretary(
      req(`/api/hermes/v1/secretario/${LEAD}`, {
        reply_ref: "2026-10-13T12:00:00.000+00:00",
        resposta: "Claro! Trabalho desenvolvendo páginas para clínicas. Seria possível conversar com a proprietária?",
        comercial: { papel_contato: "recepcionista", estado: "resposta_recebida" },
      }),
      params({ leadId: LEAD }),
    );
    expect(res.status).toBeLessThan(300);
    const save = rpc.mock.calls.find(([fn]) => fn === "api_secretary_save")!;
    expect(save[1].p.comercial).toBeUndefined();
    const call = rpc.mock.calls.find(([fn]) => fn === "api_commercial_update")!;
    expect(call[1].p).toEqual({ papel_contato: "recepcionista", estado: "resposta_recebida" });
  });
});
