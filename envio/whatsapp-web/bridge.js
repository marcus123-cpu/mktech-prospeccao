// Ponte local do WhatsApp Web para o enviador (mktech_envio.py --transporte whatsappweb).
// Roda no PC do Marcos com o chip de prospecção. Só escuta em 127.0.0.1.
//
// Ela NÃO decide nada e NUNCA responde cliente sozinha: só entrega o que o
// enviador pedir em POST /enviar e guarda o que chegar para GET /recebidas.
//
//   GET  /estado     -> { pronto, numero }
//   POST /enviar     -> { telefone, texto }  => { ok, id }
//   GET  /recebidas  -> [ { telefone, texto, tipo, recebida_em } ]  (esvazia a fila)
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
const inbox = [];

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", (qr) => {
  console.log("Escaneie o QR code com o WhatsApp do CHIP DE PROSPECÇÃO (Aparelhos conectados):");
  qrcode.generate(qr, { small: true });
});
client.on("ready", () => {
  ready = true;
  myNumber = client.info && client.info.wid ? client.info.wid.user : null;
  console.log(`WhatsApp pronto (número ${myNumber}).`);
});
client.on("disconnected", (reason) => {
  ready = false;
  console.log("WhatsApp desconectado:", reason);
});

client.on("message", async (msg) => {
  try {
    if (msg.fromMe || msg.isStatus || (msg.from || "").endsWith("@g.us")) return;
    let numero = (msg.from || "").replace(/@.*/, "");
    if ((msg.from || "").endsWith("@lid")) {
      const c = await msg.getContact();
      numero = c && c.number ? c.number : numero;
    }
    const tipo = msg.type === "ptt" || msg.type === "audio" ? "audio" : msg.type === "image" ? "imagem" : msg.type === "chat" ? "texto" : "outro";
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
  if (TOKEN && req.headers["x-bridge-token"] !== TOKEN) return send(res, 401, { ok: false, erro: "token" });
  try {
    if (req.method === "GET" && req.url === "/estado") return send(res, 200, { pronto: ready, numero: myNumber });
    if (req.method === "GET" && req.url === "/recebidas") return send(res, 200, inbox.splice(0, inbox.length));
    if (req.method === "POST" && req.url === "/enviar") {
      const { telefone, texto } = await readJson(req);
      const digits = String(telefone || "").replace(/\D/g, "");
      if (!ready) return send(res, 503, { ok: false, erro: "WhatsApp não está conectado" });
      if (!digits || typeof texto !== "string" || !texto.trim()) return send(res, 400, { ok: false, erro: "dados inválidos" });
      if (ONLY_TO.size && !ONLY_TO.has(digits)) return send(res, 403, { ok: false, erro: "destino fora de ENVIO_SO_PARA" });
      const id = await client.getNumberId(digits);
      if (!id) return send(res, 422, { ok: false, erro: "número não tem WhatsApp" });
      const sent = await client.sendMessage(id._serialized, texto);
      return send(res, 200, { ok: true, id: sent && sent.id ? sent.id._serialized : null });
    }
    return send(res, 404, { ok: false, erro: "não encontrado" });
  } catch (e) {
    return send(res, 500, { ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Ponte em http://127.0.0.1:${PORT}`));
client.initialize();
