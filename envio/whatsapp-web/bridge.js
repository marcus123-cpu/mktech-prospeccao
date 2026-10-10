// Ponte local do WhatsApp Web para o enviador (mktech_envio.py --transporte whatsappweb).
// Roda no PC do Marcos com o chip de prospecção. Só escuta em 127.0.0.1.
//
// Ela NÃO decide nada e NUNCA responde cliente sozinha: só entrega o que o
// enviador pedir em POST /enviar e guarda o que chegar para GET /recebidas.
//
//   GET  /qr         -> página com o QR code para conectar o chip (abra no navegador do PC)
//   GET  /estado     -> { pronto, numero }
//   POST /enviar     -> { telefone, texto }  => { ok, id }
//   GET  /recebidas  -> [ { telefone, texto, tipo, recebida_em } ]  (esvazia a fila)
//   GET  /minhas     -> [ { telefone, enviada_em } ]  o que o Marcos escreveu à mão (sem texto)
//
// Variáveis: BRIDGE_PORT (3799), BRIDGE_TOKEN (opcional), ENVIO_SO_PARA (lista de números).

const http = require("http");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const PORT = Number(process.env.BRIDGE_PORT || 3799);
const TOKEN = process.env.BRIDGE_TOKEN || "";
const ONLY_TO = new Set(
  (process.env.ENVIO_SO_PARA || "").split(",").map((x) => x.replace(/\D/g, "")).filter(Boolean)
);

let ready = false;
let myNumber = null;
let lastQr = null;
let lastState = "iniciando";
const setState = (st) => { lastState = st; console.log("[estado]", st); };
const inbox = [];
const minhas = []; // o que o Marcos escreveu à mão (só telefone e horário; nunca o texto)
const enviadasPelaPonte = new Set();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: "chip2" }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
  // Versão do WhatsApp Web servida pelo cache remoto: evita travar em "carregando conversas".
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
  },
});

client.on("qr", (qr) => {
  lastQr = qr;
  setState("aguardando leitura do QR");
  console.log("Escaneie o QR code com o WhatsApp do CHIP DE PROSPECÇÃO (Aparelhos conectados):");
  qrcode.generate(qr, { small: true });
});
client.on("ready", () => {
  setState("conectado");
  ready = true;
  lastQr = null;
  myNumber = client.info && client.info.wid ? client.info.wid.user : null;
  console.log(`WhatsApp pronto (número ${myNumber}).`);
});
client.on("loading_screen", (pct, msg) => setState(`carregando ${pct}% ${msg || ""}`));
client.on("authenticated", () => setState("autenticado, carregando conversas"));
client.on("auth_failure", (m) => setState("falha de autenticação: " + m));
client.on("change_state", (st) => console.log("[estado] WhatsApp:", st));
client.on("disconnected", (reason) => {
  setState("desconectado: " + reason);
  ready = false;
  console.log("WhatsApp desconectado:", reason);
});

// O WhatsApp esconde o número atrás de um identificador (LID): descobre o telefone real.
async function numeroDe(id, msg) {
  if (!id.endsWith("@lid")) return id.replace(/@.*/, "");
  let achou = null;
  try {
    const r = await client.getContactLidAndPhone([id]);
    if (r && r[0] && r[0].pn) achou = String(r[0].pn).replace(/@.*/, "");
  } catch (_) { /* tenta o outro caminho */ }
  if (!achou) {
    try {
      const c = await msg.getContact();
      if (c && c.number) achou = c.number;
    } catch (_) { /* sem número */ }
  }
  return achou;
}

const ehConversaIndividual = (id) => id && !id.endsWith("@g.us") && !id.endsWith("@newsletter") && !id.endsWith("@broadcast");

// Mensagem escrita à mão no celular do chip: guarda só telefone e horário, para saber quem falou por último.
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe || msg.isStatus) return;
    const id = msg.id && msg.id._serialized;
    if (id && enviadasPelaPonte.has(id)) return; // foi a própria ponte (saudação, texto ou lembrete)
    const to = msg.to || "";
    if (!ehConversaIndividual(to)) return;
    const numero = await numeroDe(to, msg);
    if (!numero) return;
    console.log("[minha]", to, "->", numero);
    minhas.push({
      telefone: "+" + numero.replace(/\D/g, ""),
      enviada_em: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
    });
  } catch (e) {
    console.log("erro ao guardar mensagem minha:", e.message);
  }
});

// Eventos do próprio WhatsApp (aviso de criptografia, protocolo, chamada, mensagem apagada...) não são uma pessoa escrevendo.
const TIPOS_DE_SISTEMA = new Set([
  "e2e_notification", "notification", "notification_template", "gp2", "protocol", "call_log",
  "revoked", "ciphertext", "unknown", "broadcast_notification", "reaction",
]);

client.on("message", async (msg) => {
  try {
    const from = msg.from || "";
    if (msg.fromMe || msg.isStatus || !ehConversaIndividual(from)) return;
    if (TIPOS_DE_SISTEMA.has(msg.type)) {
      console.log("[ignorada] evento do WhatsApp (" + msg.type + ") de", from);
      return;
    }
    const numero = await numeroDe(from, msg);
    if (!numero) {
      console.log("[recebida] sem número para", from, "- ignorada");
      return;
    }
    const tipo = msg.type === "ptt" || msg.type === "audio" ? "audio" : msg.type === "image" ? "imagem" : msg.type === "chat" ? "texto" : "outro";
    console.log("[recebida]", tipo, "de", from, "->", numero);
    inbox.push({
      telefone: "+" + numero.replace(/\D/g, ""),
      texto: tipo === "texto" ? msg.body : null,
      tipo,
      recebida_em: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
    });
  } catch (e) {
    console.log("erro ao guardar mensagem recebida:", e.message);
  }
});


const QR_PAGE = (qr) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="refresh" content="20">
<title>Conectar o chip de prospecção</title>
<body style="font-family:system-ui;text-align:center;padding:32px">
<h2>Conectar o chip de prospecção</h2>
${ready ? "<p><b>Já está conectado.</b> Pode fechar esta página.</p>" : qr
  ? '<p>No celular do chip: WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho, e escaneie:</p><div id="qr" style="display:inline-block"></div><p style="color:#666">A página atualiza sozinha.</p>'
  : `<p>Aguardando o QR code... a página atualiza sozinha.</p><p style="color:#666">Estado: ${lastState}</p>`}
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>const q=${JSON.stringify(qr || "")};if(q&&!${ready}){new QRCode(document.getElementById("qr"),{text:q,width:280,height:280});}</script>`;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 20000) reject(new Error("corpo grande demais"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); }
    });
  });
}

function send(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(out) });
  res.end(out);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/qr") {
    // Página do QR: só abre no próprio PC (a ponte escuta em 127.0.0.1) e não usa o token.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(QR_PAGE(lastQr));
  }
  if (TOKEN && req.headers["x-bridge-token"] !== TOKEN) return send(res, 401, { ok: false, erro: "token" });
  try {
    if (req.method === "GET" && req.url === "/estado") return send(res, 200, { pronto: ready, numero: myNumber, estado: lastState });
    if (req.method === "GET" && req.url === "/recebidas") return send(res, 200, inbox.splice(0, inbox.length));
    if (req.method === "GET" && req.url === "/minhas") return send(res, 200, minhas.splice(0, minhas.length));
    if (req.method === "POST" && req.url === "/enviar") {
      const { telefone, texto } = await readJson(req);
      const digits = String(telefone || "").replace(/\D/g, "");
      if (!ready) return send(res, 503, { ok: false, erro: "WhatsApp não está conectado" });
      if (!digits || typeof texto !== "string" || !texto.trim()) return send(res, 400, { ok: false, erro: "dados inválidos" });
      if (ONLY_TO.size && !ONLY_TO.has(digits)) return send(res, 403, { ok: false, erro: "destino fora de ENVIO_SO_PARA" });
      const id = await client.getNumberId(digits);
      if (!id) return send(res, 422, { ok: false, erro: "número não tem WhatsApp" });
      const sent = await client.sendMessage(id._serialized, texto);
      if (sent && sent.id && sent.id._serialized) {
        enviadasPelaPonte.add(sent.id._serialized);
        if (enviadasPelaPonte.size > 500) enviadasPelaPonte.delete(enviadasPelaPonte.values().next().value);
      }
      return send(res, 200, { ok: true, id: sent && sent.id ? sent.id._serialized : null });
    }
    return send(res, 404, { ok: false, erro: "não encontrado" });
  } catch (e) {
    return send(res, 500, { ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Ponte em http://127.0.0.1:${PORT}`));
setState("abrindo o navegador interno");
client.initialize().catch((e) => setState("erro ao iniciar: " + String(e.message || e).slice(0, 300)));
