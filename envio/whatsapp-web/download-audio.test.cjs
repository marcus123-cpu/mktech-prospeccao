const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {downloadAudio,decryptAudio}=require('./download-audio');
test('fallback authenticates and decrypts only the media for the current message',async()=>{
 const key=crypto.randomBytes(32),plain=Buffer.from('OggS synthetic audio'),hash=crypto.createHash('sha256').update(plain).digest();
 const expanded=Buffer.from(crypto.hkdfSync('sha256',key,Buffer.alloc(32),'WhatsApp Audio Keys',112)),iv=expanded.subarray(0,16);
 const c=crypto.createCipheriv('aes-256-cbc',expanded.subarray(16,48),iv),cipher=Buffer.concat([c.update(plain),c.final()]);
 const mac=crypto.createHmac('sha256',expanded.subarray(48,80)).update(iv).update(cipher).digest().subarray(0,10),encrypted=Buffer.concat([cipher,mac]);
 const message={id:{$1:'false_test_123'},mediaKey:key.toString('base64'),_data:{directPath:'/v/audio.enc',filehash:hash.toString('base64'),mimetype:'audio/ogg'},downloadMedia:async()=>{throw Error('t');}};
 const downloaded=await downloadAudio(message,async url=>{assert.equal(url.hostname,'mmg.whatsapp.net');return new Response(encrypted);});
 assert.deepEqual(Buffer.from(downloaded.data,'base64'),plain);
 const corrupt=Buffer.from(encrypted);corrupt[0]^=1;assert.throws(()=>decryptAudio(corrupt,key,hash),/integrity/);
 await assert.rejects(downloadAudio({...message,_data:{...message._data,directPath:'//untrusted.example/file'}},()=>{throw Error('must not fetch');}),/metadata/);
});
