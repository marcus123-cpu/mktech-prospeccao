// Sugestões de resposta para o Marcos copiar quando um cliente responde à
// abordagem automática. O sistema nunca envia nada: são só textos prontos,
// sem preço (o valor depende do serviço e é conversado pelo Marcos).

export type Sugestao = { id: string; titulo: string; texto: string };

const firstName = (s?: string | null) => (s ?? "").trim().split(/\s+/)[0] ?? "";

export function sugestoesResposta(input: { nome?: string | null; negocio?: string | null }): Sugestao[] {
  const nome = firstName(input.nome);
  const oi = nome ? `${nome}, ` : "";
  const negocio = input.negocio?.trim() || "seu negócio";
  return [
    {
      id: "aceitou",
      titulo: "Cliente topou ver a ideia",
      texto: `Que bom, ${oi}obrigado pelo retorno! Vou te mostrar de forma rápida como ficaria para ${negocio}. Prefere que eu explique por aqui mesmo ou por uma ligação curta de 10 minutos?`,
    },
    {
      id: "como-funciona",
      titulo: "Cliente quer entender melhor",
      texto: `Claro, ${oi}explico sim. Montamos algo sob medida para ${negocio}, pode ser uma página para atrair e agendar clientes, um sistema ou uma automação do atendimento. Se quiser, te mostro um exemplo de um sistema que entregamos, o da Polpuja.`,
    },
    {
      id: "valor",
      titulo: "Cliente perguntou o valor",
      texto: `${nome ? `${nome}, o` : "O"} valor depende do que faz mais sentido para ${negocio}, então prefiro entender o que você precisa antes de te passar uma proposta justa. Posso te fazer duas perguntas rápidas?`,
    },
    {
      id: "sem-interesse",
      titulo: "Cliente sem interesse",
      texto: `Sem problema, ${oi}agradeço a atenção e desejo muito sucesso para ${negocio}. Se um dia fizer sentido, estou à disposição.`,
    },
  ];
}
