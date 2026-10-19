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
//   GET  /audio/<arquivo> -> bytes do áudio guardado (POST /audio/apagar remove)
//   GET  /minhas     -> [ { telefone, texto, tipo, message_id, enviada_em } ]
//
// Variáveis: BRIDGE_PORT (3799), BRIDGE_TOKEN (opcional), ENVIO_SO_PARA (lista de números).

const http = require("http");
const qrcode = require("qrcode-terminal");
require('./compat-media').ensureMediaCompatibility();
require('./compat-history').ensureHistoryCompatibility();
require('./compat-download').ensureDownloadCompatibility();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const path = require("node:path");
const { Journal } = require("./journal");
const { DemoLibrary } = require("./demo-library");
const { messageId, prepareMediaMessage } = require('./message-id');
const { syncHistory } = require('./history');
const { deliverVoice } = require('./voice');
const { deliverAttachment } = require('./attachment');
const { downloadAudio } = require('./download-audio');
// Somente configurações conhecidas, sem executar comandos contidos no .env.
const envFile = path.join(__dirname, "..", ".env");
if (require('node:fs').existsSync(envFile)) {
  for (const line of require('node:fs').readFileSync(envFile,'utf8').split(/\r?\n/)) {
    const match = /^\s*(BRIDGE_\w+|HERMES_DEMO_ROOT|ENVIO_SO_PARA)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
  }
}
const journal = new Journal(process.env.BRIDGE_JOURNAL_PATH || path.join(__dirname, ".bridge-journal.json"));
const demos = new DemoLibrary();
const chromePath = process.env.BRIDGE_CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>require('node:fs').existsSync(p));

const PORT = Number(process.env.BRIDGE_PORT || 3799);
const TOKEN = process.env.BRIDGE_TOKEN || "";
const ONLY_TO = new Set(
  (process.env.ENVIO_SO_PARA || "").split(",").map((x) => x.replace(/\D/g, "")).filter(Boolean)
);

let ready = false;
let myNumber = null;
let lastQr = null;
let lastState = "iniciando";
let historySync = { estado: 'aguardando_conexao' };
let syncingHistory = false;
const setState = (st) => { lastState = st; console.log("[estado]", st); };
const inbox = { push: (payload) => journal.push("recebidas", payload) };
const minhas = { push: (payload) => journal.push("minhas", payload) };
const enviadasPelaPonte = new Set();
const enviosEmAndamento = new Set();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: "chip2" }),
  puppeteer: { headless: true, protocolTimeout: 600000, ...(chromePath ? {executablePath:chromePath} : {}), args: ["--no-sandbox"] },
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
  if (!syncingHistory) {
    syncingHistory = true;
    historySync = { estado: 'sincronizando' };
    syncHistory(client, journal, numeroDe, ehConversaIndividual, TIPOS_DE_SISTEMA, 300, guardarAudio)
      .then(result => { historySync = { estado: result.errors.length ? 'parcial' : 'concluido', ...result }; })
      .catch(error => { historySync = { estado: 'erro', erro: String(error.message).slice(0, 160) }; })
      .finally(() => { syncingHistory = false; console.log('[historico]', historySync); });
  }
});
client.on("loading_screen", (pct, msg) => setState(`carregando ${pct}% ${msg || ""}`));
client.on("authenticated", () => setState("autenticado, carregando conversas"));
client.on("auth_failure", (m) => setState("falha de autenticação: " + m));
client.on("change_state", (st) => console.log("[estado] WhatsApp:", st));
let religando = false;
client.on("disconnected", (reason) => {
  setState("desconectado: " + reason);
  ready = false;
  console.log("WhatsApp desconectado:", reason);
  // Religa para gerar um QR novo sem precisar reiniciar a ponte (no máximo uma tentativa por vez).
  if (religando) return;
  religando = true;
  setTimeout(async () => {
    try { await client.destroy(); } catch (e) { console.log("destroy:", e.message); }
    try { await client.initialize(); setState("aguardando leitura do QR"); } catch (e) { console.log("religar falhou:", e.message); }
    religando = false;
  }, 5000);
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

// Áudios ficam em disco até o enviador subir para o servidor (GET /audio/<arquivo>, depois POST /audio/apagar).
const AUDIO_DIR = path.join(__dirname, "audio");
const AUDIO_FILE = /^[0-9a-f]{8,160}\.bin$/;
async function guardarAudio(msg, id) {
  if (!id || !msg.hasMedia) return {};
  try {
    if (!prepareMediaMessage(msg)) return {};
    const fs = require("node:fs");
    const arquivo = Buffer.from(String(id), "utf8").toString("hex").slice(0, 160) + ".bin";
    if (fs.existsSync(path.join(AUDIO_DIR, arquivo))) return { audio_arquivo: arquivo, audio_mime: String(msg._data?.mimetype || "audio/ogg").split(";")[0].trim().toLowerCase() };
    const media = await downloadAudio(msg);
    if (!media || !media.data || media.data.length > 16 * 1024 * 1024) return {};
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUDIO_DIR, arquivo), Buffer.from(media.data, "base64"));
    return { audio_arquivo: arquivo, audio_mime: String(media.mimetype || "audio/ogg").split(";")[0].trim().toLowerCase() };
  } catch (e) {
    console.log("não consegui baixar o áudio:", e.message);
    return {};
  }
}

const ehConversaIndividual = (id) => id && !id.endsWith("@g.us") && !id.endsWith("@newsletter") && !id.endsWith("@broadcast");

// Mensagem escrita no celular do chip. Exclui as enviadas por esta ponte,
// inclusive se o evento chegar antes de sendMessage devolver o ID.
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe || msg.isStatus) return;
    const id = messageId(msg);
    if (id && (enviadasPelaPonte.has(id) || journal.results().some(item=>item.provider_id===id))) return;
    const to = msg.to || "";
    if (!ehConversaIndividual(to)) return;
    if (TIPOS_DE_SISTEMA.has(msg.type)) return;
    if ([...enviosEmAndamento].some((item) => item.to === to && item.texto === (msg.body || ''))) return;
    const numero = await numeroDe(to, msg);
    if (!numero) return;
    if (id && (enviadasPelaPonte.has(id) || journal.results().some(item=>item.provider_id===id))) return;
    if ([...enviosEmAndamento].some(item=>item.phone===numero.replace(/\D/g,'') && item.texto===(msg.body || ''))) return;
    console.log("[minha]", to, "->", numero);
    minhas.push({
      telefone: "+" + numero.replace(/\D/g, ""),
      texto: typeof msg.body === "string" && msg.body.trim() ? msg.body.slice(0, 4000) : null,
      tipo: msg.type === "chat" ? "texto" : msg.type === "ptt" || msg.type === "audio" ? "audio" : msg.type === "image" ? "imagem" : "outro",
      message_id: id || null,
      enviada_em: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
      ...(msg.type === "ptt" || msg.type === "audio" ? await guardarAudio(msg, id) : {}),
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
      message_id: messageId(msg),
      telefone: "+" + numero.replace(/\D/g, ""),
      texto: tipo === "texto" ? msg.body : null,
      tipo,
      recebida_em: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
      ...(tipo === "audio" ? await guardarAudio(msg, messageId(msg)) : {}),
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

function readJson(req, maxBytes = 20000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > maxBytes) { data = ''; reject(new Error("corpo grande demais")); req.destroy(); }
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
    if (req.method === "GET" && req.url === "/estado") return send(res, 200, { pronto: ready, numero: myNumber, estado: lastState, qr: ready ? null : lastQr, demonstrations:demos.availability().map(d=>({...d,available:d.available && (demos.resolve(d.id).kind!=='video' || !!chromePath)})) });
    if (req.method === "GET" && req.url === "/recebidas") return send(res, 200, journal.list("recebidas"));
    if (req.method === "GET" && req.url === "/historico") return send(res, 200, journal.list("historico"));
    if (req.method === "GET" && req.url === "/historico/estado") return send(res, 200, historySync);
    if (req.method === "GET" && req.url === "/minhas") return send(res, 200, journal.list("minhas"));
    if (req.method === "GET" && req.url === "/resultados") return send(res, 200, journal.pendingResults());
    if (req.method === "GET" && req.url.startsWith("/audio/")) {
      const arquivo = decodeURIComponent(req.url.slice(7));
      if (!AUDIO_FILE.test(arquivo)) return send(res, 400, { ok: false });
      const file = path.join(AUDIO_DIR, arquivo);
      if (!require("node:fs").existsSync(file)) return send(res, 404, { ok: false });
      const bytes = require("node:fs").readFileSync(file);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
      return res.end(bytes);
    }
    if (req.method === "POST" && req.url === "/audio/apagar") {
      const body = await readJson(req);
      if (typeof body.arquivo === "string" && AUDIO_FILE.test(body.arquivo)) { try { require("node:fs").unlinkSync(path.join(AUDIO_DIR, body.arquivo)); } catch (_) { /* já apagado */ } }
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/resultados/ack") {
      const body = await readJson(req);
      journal.ackResult(body.item_id,body.status); return send(res,200,{ok:true});
    }
    if (req.method === "POST" && req.url === "/eventos/ack") {
      const body = await readJson(req);
      if (!Array.isArray(body.ids) || body.ids.length > 100 || !body.ids.every(x => typeof x === 'string')) return send(res, 400, { ok: false });
      journal.ack(body.ids); return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/enviar") {
      const { telefone, texto, item_id, media, asset } = await readJson(req);
      const digits = String(telefone || "").replace(/\D/g, "");
      if (!ready) return send(res, 503, { ok: false, erro: "WhatsApp não está conectado" });
      if (!digits || typeof texto !== "string" || !texto.trim()) return send(res, 400, { ok: false, erro: "dados inválidos" });
      if (ONLY_TO.size && !ONLY_TO.has(digits)) return send(res, 403, { ok: false, erro: "destino fora de ENVIO_SO_PARA" });
      if (item_id && !/^[0-9a-f-]{36}$/i.test(item_id)) return send(res, 400, { ok: false, erro: "item inválido" });
      let content = texto;
      let options = {};
      if (typeof asset === 'string' && asset.startsWith('DEMO_')) {
        if (!item_id) return send(res,422,{ok:false,erro:'Demonstração exige item de envio'});
        try { const prepared=await demos.prepare(asset,texto,MessageMedia);content=prepared.content;options=prepared.options; }
        catch(e) { return send(res,422,{ok:false,erro:String(e.message).slice(0,200)}); }
      } else if (media === "video") {
        if (!item_id || asset !== "demo" || !process.env.BRIDGE_VIDEO_PATH || !/\.mp4$/i.test(process.env.BRIDGE_VIDEO_PATH)) return send(res, 422, { ok: false, erro: "vídeo não configurado" });
        content = MessageMedia.fromFilePath(path.resolve(process.env.BRIDGE_VIDEO_PATH));
        options = {caption:texto};
      }
      if (item_id) {
        const existing = journal.begin(item_id, require('node:crypto').createHash('sha256').update(JSON.stringify([digits,texto,media,asset])).digest('hex'));
        if (existing) return send(res, 200, { ok: existing.status === 'enviada' || existing.status === 'entregue', id: existing.provider_id, message_status: existing.status });
      }
      const id = await client.getNumberId(digits);
      if (!id) { if (item_id) journal.result(item_id, 'falhou'); return send(res, 422, { ok: false, erro: "número não tem WhatsApp" }); }
      const pending = { to: id._serialized, phone:digits, texto:typeof content === 'string' ? content : texto };
      enviosEmAndamento.add(pending);
      let sent;
      try { sent = await client.sendMessage(id._serialized, content, options); }
      finally { enviosEmAndamento.delete(pending); }
      const provider = messageId(sent);
      if (provider) {
        enviadasPelaPonte.add(provider);
        if (enviadasPelaPonte.size > 500) enviadasPelaPonte.delete(enviadasPelaPonte.values().next().value);
      }
      if (item_id) journal.result(item_id, provider ? 'enviada' : 'desconhecido', provider);
      return send(res, 200, { ok: !!provider, id: provider, message_status: provider ? 'enviada' : 'desconhecido' });
    }
    if (req.method === 'POST' && req.url === '/enviar-anexo') {
      if (!ready) return send(res,503,{ok:false,erro:'WhatsApp não está conectado'});
      const body = await readJson(req, 42500000);
      const digits = String(body.telefone || '').replace(/\D/g,'');
      if (ONLY_TO.size && !ONLY_TO.has(digits)) return send(res,403,{ok:false,erro:'destino fora de ENVIO_SO_PARA'});
      try {
        const result = await deliverAttachment({client,journal,itemId:body.item_id,digits,data:body.data,mime:body.mime,filename:body.filename,caption:body.caption,MessageMedia,
          onSending:(to,phone)=>{const pending={to,phone,texto:''};enviosEmAndamento.add(pending);return()=>enviosEmAndamento.delete(pending);},
          onSent:id=>enviadasPelaPonte.add(id)});
        return send(res,200,result);
      } catch(e) { return send(res,422,{ok:false,erro:String(e.message).slice(0,200)}); }
    }
    if (req.method === 'POST' && req.url === '/enviar-voz') {
      if (!ready) return send(res, 503, { ok:false, erro:'WhatsApp não está conectado' });
      const { telefone, item_id, data, mime } = await readJson(req, 4300000);
      const digits = String(telefone || '').replace(/\D/g, '');
      if (!/^[1-9]\d{7,14}$/.test(digits) || !/^[0-9a-f-]{36}$/i.test(item_id || '')) return send(res,400,{ok:false,erro:'dados inválidos'});
      if (ONLY_TO.size && !ONLY_TO.has(digits)) return send(res,403,{ok:false,erro:'destino fora de ENVIO_SO_PARA'});
      try {
        const result = await deliverVoice({client,journal,itemId:item_id,digits,data,mime,MessageMedia,
          onSending: (to,phone) => {
            const pending = {to,phone,texto:''};
            enviosEmAndamento.add(pending);
            return () => enviosEmAndamento.delete(pending);
          },
          onSent: id => enviadasPelaPonte.add(id),
        });
        return send(res,200,result);
      } catch (error) { return send(res,422,{ok:false,erro:String(error.message).slice(0,200)}); }
    }
    return send(res, 404, { ok: false, erro: "não encontrado" });
  } catch (e) {
    return send(res, 500, { ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

client.on('message_ack', (msg, ack) => {
  const id = messageId(msg);
  for (const item of journal.results()) {
    if (id && item.provider_id === id && ack >= 2) journal.result(item.item_id, 'entregue', id);
  }
  if (!id || !msg.fromMe || !msg.timestamp || !Number.isInteger(ack) || ack < -1 || ack > 4 || !ehConversaIndividual(msg.to)) return;
  numeroDe(msg.to, msg).then(number => {
    if (!number) return;
    journal.push('historico', {
      message_id: id, telefone: '+' + number.replace(/\D/g, ''), direcao: 'saida',
      texto: typeof msg.body === 'string' ? msg.body.slice(0, 4000) : null,
      tipo: msg.type === 'chat' ? 'texto' : ['audio', 'ptt'].includes(msg.type) ? 'audio' : msg.type === 'image' ? 'imagem' : 'outro',
      ocorrida_em: new Date(msg.timestamp * 1000).toISOString(), ack, live_receipt: true,
    });
  }).catch(error => console.error('[confirmacao]', String(error.message).slice(0, 160)));
});

server.listen(PORT, "127.0.0.1", () => console.log(`Ponte em http://127.0.0.1:${PORT}`));
setState("abrindo o navegador interno");
client.initialize().catch((e) => setState("erro ao iniciar: " + String(e.message || e).slice(0, 300)));

// Vigia: se o navegador interno travar (ex.: "detached Frame"), a ponte para de enviar e de receber sem avisar.
// Duas checagens seguidas falhando derrubam a ponte; o ponte-loop.bat sobe de novo sozinho em ~15 s.
let strikes = 0;
setInterval(async () => {
  if (!ready) return;
  try {
    await Promise.race([client.pupPage.evaluate(() => 1), new Promise((_, reject) => setTimeout(() => reject(new Error('sem resposta em 20 s')), 20000))]);
    strikes = 0;
  } catch (error) {
    strikes += 1;
    console.error(`[vigia] navegador interno com problema (${strikes}/2):`, String(error.message).slice(0, 120));
    if (strikes >= 2) { console.error('[vigia] reiniciando a ponte'); process.exit(1); }
  }
}, 45000).unref();
