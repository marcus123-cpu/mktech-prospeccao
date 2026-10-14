// Comparação das estratégias A/B/C (view strategy_metrics). A métrica que
// importa é oportunidade qualificada, não número de respostas, e com menos de
// 30 contatos por estratégia nada é declarado vencedor.

import { TESTE_POR_ESTRATEGIA } from "./estrategias";

export type LinhaMetricas = {
  estrategia: "A" | "B" | "C" | "antiga";
  contatados: number;
  mensagens_entregues: number;
  respostas_humanas: number;
  respostas_automaticas: number;
  respostas_positivas: number;
  decisores: number;
  videos_autorizados: number;
  videos_enviados: number;
  interesse: number;
  propostas_solicitadas: number;
  negociacoes: number;
  oportunidades: number;
  vendas: number;
  receita: number;
};

/** Etapas em ordem, com o denominador de cada taxa. */
export const ETAPAS: { key: keyof LinhaMetricas; label: string; base: keyof LinhaMetricas | null }[] = [
  { key: "contatados", label: "Contatados", base: null },
  { key: "mensagens_entregues", label: "Mensagem da estratégia entregue", base: "contatados" },
  { key: "respostas_humanas", label: "Respostas de pessoas", base: "contatados" },
  { key: "respostas_automaticas", label: "Respostas automáticas", base: "contatados" },
  { key: "respostas_positivas", label: "Respostas positivas", base: "respostas_humanas" },
  { key: "decisores", label: "Falou com quem decide", base: "respostas_humanas" },
  { key: "videos_autorizados", label: "Autorizou o vídeo", base: "respostas_humanas" },
  { key: "videos_enviados", label: "Vídeo enviado", base: "videos_autorizados" },
  { key: "interesse", label: "Interesse demonstrado", base: "respostas_humanas" },
  { key: "propostas_solicitadas", label: "Pediu proposta ou valor", base: "respostas_humanas" },
  { key: "negociacoes", label: "Negociação iniciada", base: "respostas_humanas" },
  { key: "oportunidades", label: "Oportunidade qualificada", base: "contatados" },
  { key: "vendas", label: "Venda fechada", base: "oportunidades" },
];

export function taxa(parte: number, base: number): number | null {
  return base > 0 ? parte / base : null;
}

export function fmtTaxa(t: number | null): string {
  return t === null ? "—" : `${Math.round(t * 100)}%`;
}

/** Mínimo de contatos por estratégia antes de comparar com alguma segurança. */
export const MINIMO_COMPARACAO = 30;

export type Leitura = { exploratoria: boolean; texto: string };

/** Frase de leitura do teste. Nunca aponta vencedora com amostra pequena. */
export function leituraDoTeste(linhas: LinhaMetricas[]): Leitura {
  const abc = linhas.filter((l) => l.estrategia !== "antiga");
  const menor = abc.length < 3 ? 0 : Math.min(...abc.map((l) => l.contatados));
  const totalContatos = abc.reduce((s, l) => s + l.contatados, 0);
  if (menor < MINIMO_COMPARACAO) {
    const falta = Math.max(0, TESTE_POR_ESTRATEGIA * 3 - totalContatos);
    return {
      exploratoria: true,
      texto:
        totalContatos === 0
          ? "Nenhum contato com as estratégias novas ainda."
          : `Teste exploratório: ${totalContatos} contato(s) com A/B/C${falta ? `, faltam ${falta} para os 30 iniciais` : ""}. Amostra pequena: não dá para dizer qual estratégia é melhor. Compare oportunidades qualificadas, não respostas.`,
    };
  }
  return {
    exploratoria: false,
    texto: "Cada estratégia tem 30 contatos ou mais. Compare a taxa de oportunidades qualificadas; diferenças pequenas ainda podem ser acaso.",
  };
}
