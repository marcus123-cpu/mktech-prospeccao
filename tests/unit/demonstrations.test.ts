import {describe,it,expect} from 'vitest';
import catalog from '../../hermes/videos-demonstracao/catalogo.json';
import {selectDemonstration,type Demonstration} from '@/lib/commercial/demonstrations';
import {decide,type Context} from '@/lib/commercial/engine';
const demos=catalog.materials as Demonstration[];
function ctx(body:string):Context{return {business_name:'Teste',research:{},state:{stage:'CONTATO_COM_DECISOR',role:'OWNER',role_confidence:1,role_evidence:'Sou a proprietária',strategy:'A',video_offered:false,video_authorized:false,video_sent_at:null,facts:{},followup_at:null,followup_reason:null},messages:[{direction:'entrada',kind:'humana',body}],products:[],video_configured:true,manual:false,do_not_contact:false,first_contact:false,now:'2026-10-13T12:00:00Z',demonstrations:demos,demonstration_history:[]};}
describe('demonstrações reais',()=>{
 it.each(['landing page','portfólio','procedimentos'])('seleciona Rosana para %s',s=>expect(selectDemonstration(demos,[s])?.id).toBe('DEMO_ROSANA_LANDING'));
 it.each(['site vitrine','apresentação de produtos','site institucional'])('seleciona Polpujá para %s',s=>expect(selectDemonstration(demos,[s])?.id).toBe('DEMO_POLPUJA_VITRINE'));
 it('sem aprovação não oferece',()=>expect(selectDemonstration(demos.map(d=>({...d,approved:false})),['landing page'])).toBeUndefined());
 it.each(demos)('oferece e só envia $name após autorização contextual',d=>{const c=ctx(d.match_terms[0]);const offer=decide(c);expect(offer.action).toBe('text');expect(offer.demonstration_id).toBe(d.id);c.state=offer.state;c.messages.push({direction:'saida',body:offer.body},{direction:'entrada',body:'Pode enviar',kind:'humana'});const sent=decide(c);expect(sent.action).toBe('demonstration');expect(sent.demonstration_id).toBe(d.id);expect(sent.body).not.toContain('https://');});
 it('sim sem oferta não envia demonstração',()=>expect(decide(ctx('Sim')).action).not.toBe('demonstration'));
 it.each(['Mande o exemplo','Envie o vídeo','Manda sim'])('aceita autorização contextual: %s',text=>{const c=ctx(text);c.state.facts.demo_offered=demos[0].id;c.messages.unshift({direction:'saida',body:demos[0].offer});expect(decide(c).action).toBe('demonstration');});
 it('recusa de exemplo não gera nova oferta',()=>expect(decide(ctx('Não quero esse exemplo')).action).toBe('wait'));
 it('pedido por outro tipo de material requer nova oferta',()=>{const c=ctx('Pode enviar o exemplo de site vitrine');c.state.facts.demo_offered=demos[0].id;c.messages.unshift({direction:'saida',body:demos[0].offer});const d=decide(c);expect(d.action).toBe('text');expect(d.demonstration_id).toBe('DEMO_POLPUJA_VITRINE');});
 it('arquivo indisponível gera encaminhamento',()=>{const c=ctx('landing page');c.demonstrations=demos.map(d=>({...d,available:false}));expect(decide(c).action).toBe('handoff');});
 it('registro anterior impede repetição',()=>{const c=ctx('landing page');c.demonstration_history=[{demonstration_id:demos[0].id,status:'enviada',sent_at:c.now}];expect(decide(c).intent).toBe('demonstracao_ja_registrada');});
 it('novo material usa termos do catálogo sem alterar prompt',()=>{const c=ctx('Quero uma fachada virtual');c.demonstrations=[{...demos[1],id:'DEMO_NOVO',match_terms:['fachada virtual']}];expect(decide(c).demonstration_id).toBe('DEMO_NOVO');});
});
