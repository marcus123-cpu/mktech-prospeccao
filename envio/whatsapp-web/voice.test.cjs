const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareVoice, deliverVoice } = require('./voice');
function wav() {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF',0); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(8000,24); bytes.writeUInt32LE(16000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34);
  bytes.write('data',36); bytes.writeUInt32LE(16000,40);
  return bytes;
}
test('converts a real WAV to OGG Opus voice format', async () => {
  const voice = await prepareVoice(wav().toString('base64'), 'audio/wav');
  const output = Buffer.from(voice.base64, 'base64');
  assert.equal(output.subarray(0,4).toString(), 'OggS');
  assert.ok(output.includes(Buffer.from('OpusHead')));
  assert.ok(voice.duration > 0.9 && voice.duration < 1.2);
  assert.equal(voice.mime,'audio/ogg; codecs=opus');
});
test('rejects malformed, oversized and non-audio inputs', async () => {
  await assert.rejects(prepareVoice('@@@@', 'audio/wav'), /inválido/);
  await assert.rejects(prepareVoice('YQ==', 'application/pdf'), /inválido/);
  await assert.rejects(prepareVoice(Buffer.alloc(3*1024*1024+1).toString('base64'), 'audio/wav'), /3 MB/);
  await assert.rejects(prepareVoice('bm90IGF1ZGlv', 'audio/wav'), /converter/);
});
test('sends PTT once and keeps manual confirmations out of the commercial queue', async () => {
  const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
  const {Journal}=require('./journal');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-test-'));
  try {
    const journal=new Journal(path.join(dir,'journal.json'));
    const calls=[];
    const client={getNumberId:async()=>({_serialized:'5511999999999@c.us'}),sendMessage:async(...args)=>{calls.push(args);return {id:{_serialized:'ptt-provider-id'}};}};
    class Media { constructor(mime,data,name) {Object.assign(this,{mime,data,name});} }
    const item={client,journal,itemId:'voice-item',digits:'5511999999999',data:wav().toString('base64'),mime:'audio/wav',MessageMedia:Media};
    assert.equal((await deliverVoice(item)).ok,true);
    assert.equal((await deliverVoice(item)).id,'ptt-provider-id');
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0][2],{sendAudioAsVoice:true});
    assert.equal(calls[0][1].mime,'audio/ogg; codecs=opus');
    assert.equal(journal.pendingResults().length,0);
    await assert.rejects(deliverVoice({...item,data:'YQ=='}),/conteúdo diferente/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
