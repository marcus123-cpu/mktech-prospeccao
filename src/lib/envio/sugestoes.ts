// Sugestões de resposta para o Marcos copiar quando um cliente responde à
// abordagem. O sistema nunca envia nada: são textos de referência do fluxo
// comercial (src/lib/prospeccao/conversa.ts), sem preço, reunião ou ligação.

import { REFERENCIAS } from "@/lib/prospeccao/conversa";

export type Sugestao = { id: string; titulo: string; texto: string };

const firstName = (s?: string | null) => (s ?? "").trim().split(/\s+/)[0] ?? "";

export function sugestoesResposta(input: { nome?: string | null; negocio?: string | null }): Sugestao[] {
  const nome = firstName(input.nome);
  const oi = nome ? `${nome}, ` : "";
  const negocio = input.negocio?.trim() || "seu negócio";
  return [
    {
      id: "recepcao",
      titulo: "Recepção respondeu",
      texto: REFERENCIAS.recepcionista_cumprimento,
    },
    {
      id: "aceitou",
      titulo: "Cliente topou ver a ideia",
      texto: `Que bom, ${oi}obrigado pelo retorno! Tenho um vídeo curtinho mostrando como ficaria uma página para ${negocio}. Posso te mandar por aqui?`,
    },
    {
      id: "como-funciona",
      titulo: "Cliente quer entender melhor",
      texto: `Claro, ${oi}explico sim. Crio páginas para clínicas de estética, com os procedimentos de ${negocio} organizados e um botão direto para agendar pelo WhatsApp. Posso te mostrar um exemplo visual rápido?`,
    },
    {
      id: "valor",
      titulo: "Cliente perguntou o valor",
      texto: `${nome ? `${nome}, o` : "O"} valor depende do que fizer sentido para ${negocio}, como quantos procedimentos entram e se tem agendamento. Já te explico certinho.`,
    },
    {
      id: "ja-tem-site",
      titulo: "Cliente já tem site",
      texto: REFERENCIAS.ja_tem_site,
    },
    {
      id: "sem-interesse",
      titulo: "Cliente sem interesse",
      texto: `Sem problema, ${oi}agradeço a atenção e desejo muito sucesso para ${negocio}. Se um dia fizer sentido, estou à disposição.`,
    },
  ];
}
