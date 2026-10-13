const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
class DemoLibrary {
  constructor(root=process.env.HERMES_DEMO_ROOT || path.resolve(__dirname,'../../hermes/videos-demonstracao')) { this.root=path.resolve(root); }
  catalog(){const c=JSON.parse(fs.readFileSync(path.join(this.root,'catalogo.json'),'utf8'));if(!Array.isArray(c.materials))throw new Error('Catálogo inválido');return c.materials;}
  resolve(id){
    const d=this.catalog().find(d=>d.id===id && d.approved);
    if(!d)throw new Error('Demonstração não cadastrada ou não aprovada');
    if(d.kind==='link') {const url=new URL(d.url);if(url.protocol!=='https:')throw new Error('URL de demonstração deve usar HTTPS');return {...d};}
    if(d.kind!=='video'||d.format!=='video/mp4'||path.isAbsolute(d.path))throw new Error('Formato ou caminho de demonstração inválido');
    const file=path.resolve(this.root,d.path);
    const realRoot=fs.realpathSync(this.root);
    const realFile=fs.realpathSync(file);
    const relative=path.relative(realRoot,realFile);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Arquivo fora da biblioteca');
    const stat=fs.statSync(realFile);if(!stat.isFile()||!stat.size||stat.size!==d.size_bytes)throw new Error('Vídeo ausente ou tamanho diferente do catálogo');
    const hash=crypto.createHash('sha256').update(fs.readFileSync(realFile)).digest('hex');
    if(hash!==d.sha256)throw new Error('Integridade do vídeo divergente');
    return {...d,file:realFile};
  }
  availability(){return this.catalog().map(d=>{try {this.resolve(d.id);return {id:d.id,available:true};}catch{return {id:d.id,available:false};}});}
  async prepare(id,text,Media,fetcher=fetch) {
    const d=this.resolve(id);
    if(d.kind==='video')return {content:Media.fromFilePath(d.file),options:{caption:text},demonstration:d};
    const response=await fetcher(d.url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Site de demonstração indisponível');
    // URL só vem do catálogo aprovado; o solicitante não pode trocar o destino.
    const body=text.includes(d.url) ? text : `${text}\n\n${d.url}`;
    return {content:body,options:{},demonstration:d};
  }
}
module.exports={DemoLibrary};
