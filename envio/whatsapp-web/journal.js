// Estado durável da ponte. Reservas ambíguas sobrevivem reinicialização sem reenviar.
const fs = require('node:fs');
const path = require('node:path');
class Journal {
  constructor(file) {
    this.file = file;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { events: [], sends: {} };
  }
  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
  }
  push(kind, payload) {
    const event_id = payload.message_id || require('node:crypto').randomUUID();
    if (!this.data.events.some(e => e.kind === kind && e.event_id === event_id)) {
      this.data.events.push({ ...payload, event_id, kind }); this.flush();
    }
  }
  list(kind) { return this.data.events.filter(e => e.kind === kind).slice(0, 100); }
  ack(ids) { this.data.events = this.data.events.filter(e => !ids.includes(e.event_id)); this.flush(); }
  begin(key, fingerprint) {
    const existing = this.data.sends[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Chave reutilizada com conteúdo diferente');
      return existing;
    }
    this.data.sends[key] = { item_id: key, fingerprint, status: 'desconhecido', provider_id: null };
    this.flush(); return null;
  }
  result(key, status, provider_id = null) {
    if (!this.data.sends[key]) return;
    this.data.sends[key] = { ...this.data.sends[key], status, provider_id, reported: false };
    this.flush();
  }
  results() { return Object.values(this.data.sends); }
  pendingResults() { return this.results().filter(item => !item.reported).slice(0,100); }
  ackResult(key, status) {
    if (this.data.sends[key]?.status === status) { this.data.sends[key].reported = true; this.flush(); }
  }
}
module.exports = { Journal };
