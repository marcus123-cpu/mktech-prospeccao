const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {patchSource}=require('./compat-media');
test('correção é idempotente na versão instalada',()=>{const pkg=require.resolve('whatsapp-web.js/package.json');const source=fs.readFileSync(path.join(path.dirname(pkg),'src/util/Injected/Utils.js'),'utf8');const patched=patchSource(source,'1.34.7');assert.ok(patched.includes('delete message.__x_id;'));assert.ok(patched.includes('.Msg.get(newMsgKey._serialized || newMsgKey.$1);'));assert.equal(patchSource(patched,'1.34.7'),patched);assert.equal(patched.split('delete message.__x_id;').length,2);});
test('estrutura ou versão desconhecida não é alterada',()=>{assert.throws(()=>patchSource('conteúdo não reconhecido','1.34.7'));assert.throws(()=>patchSource('conteúdo não reconhecido','99.0.0'));});
