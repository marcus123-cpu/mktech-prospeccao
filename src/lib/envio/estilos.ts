// Estilos da mensagem depois da saudação (ver migração estilos_mensagem).
export type OutreachStyle = "agradecimento" | "lendo_resposta";

export const STYLE_LABEL: Record<OutreachStyle, string> = {
  agradecimento: "🙏 Agradecimento",
  lendo_resposta: "👂 Lendo a resposta",
};

/** Texto de apoio quando o "lendo a resposta" ainda não tem o texto final. */
export function styleNote(style: string | null | undefined, replyBodyAt: string | null | undefined): string | null {
  if (style !== "lendo_resposta" || replyBodyAt) return null;
  return "O Hermes escreve o texto depois de ler o que a pessoa responder. Abaixo, a prévia preparada pelo diagnóstico.";
}
