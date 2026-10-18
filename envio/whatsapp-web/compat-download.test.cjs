const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {patchDownloadSource}=require('./compat-download');
test('download lookup patch is pinned, parseable and idempotent',()=>{
 const file=path.join(path.dirname(require.resolve('whatsapp-web.js/package.json')),'src/structures/Message.js');
 const original=fs.readFileSync(file,'utf8'),patched=patchDownloadSource(original,'1.34.7');
 assert.ok(patched.includes('store.getModelsArray().find'));assert.equal(patchDownloadSource(patched,'1.34.7'),patched);
 assert.throws(()=>patchDownloadSource(original,'2.0.0'),/Revisar/);
});
