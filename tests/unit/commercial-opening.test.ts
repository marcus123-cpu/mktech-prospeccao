import { describe, expect, it } from "vitest";
import { decide, icebreaker, type Context } from "@/lib/commercial/engine";

const base: Context = {
  business_name: "Espaço Soul", city: "São José do Rio Preto", first_contact: true,
  research: { services: ["drenagem facial", "procedimento inventado"], evidences: [
    {kind:"site",url:"https://clinica.test",observed_at:"2026-10-13",summary:"Estética com drenagem facial e WhatsApp comercial"},
  ] },
  state:{stage:"QUALIFICADO",role:"UNKNOWN",role_confidence:0,role_evidence:"",strategy:"C",video_offered:false,video_authorized:false,video_sent_at:null,facts:{},followup_at:null,followup_reason:null},
  messages:[],products:[],video_configured:true,manual:false,do_not_contact:false,now:"2026-10-13T17:00:00Z",
};
function greeted(body="Boa tarde, tudo bem e você?",kind="humana") {
  const greeting=decide(base);
  return {...base,first_contact:false,state:greeting.state,messages:[{direction:"saida",body:greeting.body},{direction:"entrada",kind,media:"texto",body}]};
}
describe("conversa em degraus",()=>{
  it.each([["2026-10-13T02:00:00Z","boa noite"],["2026-10-13T12:00:00Z","bom dia"],["2026-10-13T17:00:00Z","boa tarde"],["2026-10-13T22:00:00Z","boa noite"]])("saudação no fuso de São Paulo em %s",(time,period)=>expect(icebreaker(time)).toBe(`Olá, ${period}! Tudo bem?`));
  it("primeiro envio não oferece material nem solução",()=>{const d=decide(base);expect(d.body).toBe("Olá, boa tarde! Tudo bem?");expect(d.state.video_offered).toBe(false);expect(d.state.facts.demo_offered).toBeUndefined();});
  it("aguarda resposta humana antes de investigar",()=>{expect(decide({...greeted(),messages:[{direction:"saida",body:"Olá, boa tarde! Tudo bem?"}]}).action).toBe("wait");expect(decide(greeted("Bem-vindo, mensagem automática","automatica")).action).toBe("wait");});
  it("responde à saudação usando serviços e fonte confirmados",()=>{const d=decide(greeted());expect(d.intent).toBe("abordagem_contextual");expect(d.body).toContain("Tudo ótimo");expect(d.body).toContain("na página de vocês");expect(d.body).toContain("drenagem facial");expect(d.body).not.toMatch(/inventado|Instagram|Posso te enviar|landing|MKTech/);expect(d.body!.match(/\?/g)).toHaveLength(1);});
  it("cargo declarado não pula investigação",()=>{const d=decide(greeted("Sou a proprietária"));expect(d.state.role).toBe("OWNER");expect(d.intent).toBe("abordagem_contextual");expect(d.body).not.toContain("vídeo");});
  it("próximo passo usa o canal informado pela pessoa",()=>{const ctx=greeted();const intro=decide(ctx);const d=decide({...ctx,state:intro.state,messages:[...ctx.messages,{direction:"saida",body:intro.body},{direction:"entrada",kind:"humana",body:"A maioria vem por indicação"}]});expect(d.intent).toBe("friccao_e_permissao");expect(d.body).toContain("indicação");expect(d.body).not.toContain("Instagram");expect(d.body).toContain("Posso te mostrar");expect(d.action).toBe("text");});
  it("não força dor quando a agenda já está cheia",()=>{const ctx=greeted();const intro=decide(ctx);const d=decide({...ctx,state:intro.state,messages:[...ctx.messages,{direction:"saida",body:intro.body},{direction:"entrada",kind:"humana",body:"Agenda cheia, estamos satisfeitos"}]});expect(d.action).toBe("stop");expect(d.body).not.toContain("Posso");});
  it("pergunta de preço mantém precedência sobre o roteiro",()=>expect(decide(greeted("Quanto custa?")).intent).toBe("preco_sem_escopo_aprovado"));
  it("pedido explícito de material não é ignorado em favor do roteiro",()=>{
    const demo={id:"DEMO_ROSANA_LANDING",name:"Landing page da Rosana",kind:"video" as const,description:"Vídeo de um trabalho real",format:"video/mp4",approved:true,available:true,category:"landing_page_portfolio",scopes:["landing_page"],match_terms:["landing page"],offer:"Tenho um exemplo real: Landing page da Rosana. Posso te enviar?",caption:"Exemplo"};
    const d=decide({...greeted("Quero um exemplo de landing page"),demonstrations:[demo]});
    expect(d.intent).toBe("demonstracao_oferecida");expect(d.action).toBe("text");expect(d.state.video_authorized).toBe(false);
  });
  it("recusa e controle manual continuam prevalecendo",()=>{expect(decide(greeted("Não tenho interesse")).action).toBe("stop");expect(decide({...greeted(),manual:true}).action).toBe("wait");});
});
