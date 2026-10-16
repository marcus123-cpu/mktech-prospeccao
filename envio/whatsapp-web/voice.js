const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const MAX = 3 * 1024 * 1024;
async function prepareVoice(base64, mime) {
  if (!['audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/aac'].includes(mime)) throw new Error('Tipo de áudio inválido');
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Arquivo de áudio inválido');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX) throw new Error('O áudio deve ter até 3 MB');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mktech-voice-'));
  try {
    const input = path.join(dir, 'input');
    const output = path.join(dir, 'voice.ogg');
    await fs.writeFile(input, bytes);
    const ffmpeg = process.env.BRIDGE_FFMPEG_PATH || 'ffmpeg';
    const ffprobe = path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), 'ffprobe.exe') : 'ffprobe';
    await run(ffmpeg, ['-nostdin','-hide_banner','-loglevel','error','-y','-i',input,'-vn','-map_metadata','-1','-t','601','-c:a','libopus','-b:a','32k','-ar','48000','-ac','1',output], { timeout: 60000, windowsHide: true, maxBuffer: 128 * 1024 });
    const { stdout } = await run(ffprobe, ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',output], { timeout: 10000, windowsHide: true });
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('O áudio deve ter até 10 minutos');
    const encoded = await fs.readFile(output);
    if (encoded.length > MAX) throw new Error('Áudio convertido grande demais');
    return { base64: encoded.toString('base64'), mime: 'audio/ogg; codecs=opus', duration };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('FFmpeg não está disponível na ponte');
    if (/até|inválido|grande/.test(error.message)) throw error;
    throw new Error('Não foi possível converter este áudio. Verifique se o arquivo abre normalmente.');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function deliverVoice({ client, journal, itemId, digits, data, mime, MessageMedia, onSending = () => {}, onSent = () => {} }) {
  const fingerprint = require('node:crypto').createHash('sha256').update(JSON.stringify([digits,data,mime])).digest('hex');
  const response = item => ({ ok:['enviada','entregue'].includes(item.status), id:item.provider_id, message_status:item.status });
  const previous = journal.data.sends[itemId];
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('Chave reutilizada com conteúdo diferente');
    return response(previous);
  }
  const voice = await prepareVoice(data, mime);
  const destination = await client.getNumberId(digits);
  if (!destination) throw new Error('Número não tem WhatsApp');
  const existing = journal.begin(itemId, fingerprint, 'manual');
  if (existing) return response(existing);
  const done = onSending(destination._serialized, digits);
  let sent;
  try {
    sent = await client.sendMessage(destination._serialized, new MessageMedia(voice.mime, voice.base64, 'mensagem.ogg'), {sendAudioAsVoice:true});
  } finally { if (done) done(); }
  const provider = require('./message-id').messageId(sent);
  if (provider) onSent(provider);
  journal.result(itemId, provider ? 'enviada' : 'desconhecido', provider);
  return response(journal.data.sends[itemId]);
}
module.exports = { prepareVoice, deliverVoice };
