const crypto=require('node:crypto');
const {prepareMediaMessage}=require('./message-id');
const MAX=12*1024*1024;
function binary(value){
 if(typeof value==='string')return Buffer.from(value.replace(/^data:;base64,/,''),'base64');
 if(Buffer.isBuffer(value)||Array.isArray(value))return Buffer.from(value);
 if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 if(Array.isArray(value?.data))return Buffer.from(value.data);
 return Buffer.alloc(0);
}
// Protocol derivation documented by the upstream Baileys messages-media utility.
// Keys remain on this PC; MAC and plaintext hash are checked before any upload.
function decryptAudio(encrypted,key,hash){
 if(key.length!==32||encrypted.length<26||encrypted.length>MAX+32)throw Error('audio_metadata_invalid');
 const expanded=Buffer.from(crypto.hkdfSync('sha256',key,Buffer.alloc(32),'WhatsApp Audio Keys',112));
 const iv=expanded.subarray(0,16),cipherKey=expanded.subarray(16,48),macKey=expanded.subarray(48,80);
 const cipher=encrypted.subarray(0,-10),mac=encrypted.subarray(-10);
 const expected=crypto.createHmac('sha256',macKey).update(iv).update(cipher).digest().subarray(0,10);
 if(!crypto.timingSafeEqual(mac,expected))throw Error('audio_integrity_failed');
 const decipher=crypto.createDecipheriv('aes-256-cbc',cipherKey,iv);
 const plain=Buffer.concat([decipher.update(cipher),decipher.final()]);
 if(plain.length>MAX)throw Error('audio_size_limit');
 if(hash.length===32&&!crypto.timingSafeEqual(crypto.createHash('sha256').update(plain).digest(),hash))throw Error('audio_hash_failed');
 return plain;
}
async function downloadAudio(message,fetcher=fetch){
 if(!prepareMediaMessage(message))throw Error('audio_id_missing');
 try {const result=await message.downloadMedia();if(result?.data)return result;}catch{/* Retry using this message's own media metadata. */}
 const data=message._data||{};
 const key=binary(message.mediaKey||data.mediaKey),hash=binary(data.filehash);
 if(key.length!==32||typeof data.directPath!=='string'||!data.directPath.startsWith('/')||data.directPath.startsWith('//'))throw Error('audio_metadata_unavailable');
 const url=new URL(data.directPath,'https://mmg.whatsapp.net');
 if(url.hostname!=='mmg.whatsapp.net'||url.protocol!=='https:')throw Error('audio_host_invalid');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:'https://web.whatsapp.com'}});
 if(!response.ok)throw Error(`audio_download_http_${response.status}`);
 if(Number(response.headers.get('content-length'))>MAX+32)throw Error('audio_size_limit');
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>MAX+32)throw Error('audio_size_limit');chunks.push(Buffer.from(chunk));}
 const plain=decryptAudio(Buffer.concat(chunks),key,hash);
 return {data:plain.toString('base64'),mimetype:data.mimetype||'audio/ogg'};
}
module.exports={downloadAudio,decryptAudio};
