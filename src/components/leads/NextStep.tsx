import type { Stage } from "@/lib/labels";

// Orientação simples do que fazer com o lead em cada etapa.
const STEPS: Record<Stage, { title: string; text: string }> = {
  novo: {
    title: "Fazer o primeiro contato",
    text: "Leia o diagnóstico e o ângulo de abordagem abaixo, chame pelo WhatsApp e depois use “Marcar como contatado”.",
  },
  contatado: {
    title: "Esperar a resposta e agendar retorno",
    text: "Se não responder, use “Agendar retorno” para lembrar de chamar de novo. Quando responder, mude a etapa para Respondeu.",
  },
  respondeu: {
    title: "Entender o que ele precisa",
    text: "Pergunte sobre as dores do diagnóstico. Se mostrar interesse, mude a etapa para Interessado.",
  },
  interessado: {
    title: "Mandar a proposta",
    text: "Monte a proposta com a oferta sugerida e registre em “Registrar proposta”.",
  },
  proposta_enviada: {
    title: "Acompanhar a proposta",
    text: "Agende um retorno para cobrar a resposta. Fechou? Use “Registrar fechamento”.",
  },
  fechado: { title: "Venda fechada 🎉", text: "Nada a fazer aqui. Registre observações do projeto se quiser." },
  sem_interesse: {
    title: "Sem interesse agora",
    text: "Se fizer sentido, agende um retorno para daqui a alguns meses.",
  },
  desqualificado: { title: "Fora do perfil", text: "Este lead não entra mais na prospecção." },
};

export function NextStep({ stage }: { stage: Stage }) {
  const s = STEPS[stage];
  return (
    <div className="card border-accent/40 bg-accent/5 p-4 text-sm">
      <div className="label">Próximo passo</div>
      <div className="font-semibold">{s.title}</div>
      <p className="mt-1 text-muted">{s.text}</p>
    </div>
  );
}
