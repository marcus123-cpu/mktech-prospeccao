// WA Web renamed the message-key field to $1. Keep the pinned library compatible.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function patchHistorySource(source, version) {
  if (version !== '1.34.7') throw new Error('Revisar compatibilidade do histórico nesta versão');
  const canonical = '(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1)';
  let patched = source.replaceAll(canonical, 'chat.lastReceivedKey._serialized')
    .replaceAll('chat.lastReceivedKey._serialized', canonical);
  // Do not lose every individual chat because one group cannot be serialized.
  patched = patched.replace('return await Promise.all(chatPromises);',
    "return (await Promise.allSettled(chatPromises)).filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);");
  const marker = '        delete msg.pendingAckUpdate;';
  if (!patched.includes('// MKTech canonical history ID')) {
    if (!patched.includes(marker)) throw new Error('Estrutura do modelo de mensagem mudou');
    patched = patched.replace(marker, `        // MKTech canonical history ID
        if (msg.id && !msg.id._serialized && msg.id.$1) {
            msg.id = { ...msg.id, _serialized: msg.id.$1 };
        }
${marker}`);
  }
  new vm.Script(patched);
  return patched;
}
function ensureHistoryCompatibility() {
  const pkg = require.resolve('whatsapp-web.js/package.json');
  const version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
  const file = path.join(path.dirname(pkg), 'src/util/Injected/Utils.js');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchHistorySource(source, version);
  if (patched !== source) fs.writeFileSync(file, patched);
}
module.exports = { ensureHistoryCompatibility, patchHistorySource };
