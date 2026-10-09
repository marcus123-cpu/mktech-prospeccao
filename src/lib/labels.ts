export const STAGES = [
  "novo",
  "contatado",
  "respondeu",
  "interessado",
  "proposta_enviada",
  "fechado",
  "sem_interesse",
  "desqualificado",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  novo: "Novo",
  contatado: "Contatado",
  respondeu: "Respondeu",
  interessado: "Interessado",
  proposta_enviada: "Proposta enviada",
  fechado: "Fechado",
  sem_interesse: "Sem interesse",
  desqualificado: "Desqualificado",
};

export const STAGE_COLOR: Record<Stage, string> = {
  novo: "bg-slate-700 text-slate-100",
  contatado: "bg-indigo-900/70 text-indigo-200",
  respondeu: "bg-sky-900/70 text-sky-200",
  interessado: "bg-violet-900/70 text-violet-200",
  proposta_enviada: "bg-amber-900/60 text-amber-200",
  fechado: "bg-emerald-900/70 text-emerald-200",
  sem_interesse: "bg-zinc-800 text-zinc-400",
  desqualificado: "bg-rose-950/70 text-rose-300",
};

export const SITE_STATUSES = [
  "site_proprio_encontrado",
  "site_nao_localizado",
  "apenas_redes_sociais",
  "verificacao_pendente",
] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const SITE_LABEL: Record<SiteStatus, string> = {
  site_proprio_encontrado: "Site próprio encontrado",
  site_nao_localizado: "Site próprio não localizado na pesquisa",
  apenas_redes_sociais: "Apenas redes sociais / menu de links",
  verificacao_pendente: "Verificação pendente",
};

export const PRIORITIES = ["alta", "media", "baixa"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

export const ORIGINS = ["hermes", "importacao", "manual"] as const;
export type Origin = (typeof ORIGINS)[number];
export const ORIGIN_LABEL: Record<Origin, string> = { hermes: "Hermes", importacao: "Importação", manual: "Manual" };

export const CHANNELS = ["whatsapp", "instagram", "telefone", "email", "presencial", "outro"] as const;
export const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  telefone: "Telefone",
  email: "E-mail",
  presencial: "Presencial",
  outro: "Outro",
};

export const REVIEW_REASON_LABEL: Record<string, string> = {
  nome_parecido: "Nome parecido na mesma cidade",
  telefone_compartilhado: "Telefone já usado por outro negócio",
  dominio_compartilhado: "Site já usado por outro negócio",
  instagram_outra_unidade: "Mesmo Instagram, outra unidade",
  sinais_conflitantes: "Identificadores apontam para fichas diferentes",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  em_andamento: "Em andamento",
  concluida: "Concluída",
  parcial: "Parcial",
  falhou: "Falhou",
  abandonada: "Abandonada",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  site: "Site",
  instagram: "Instagram",
  google: "Google",
  whatsapp: "WhatsApp",
  diretorio: "Diretório",
  busca: "Busca",
  outro: "Outro",
};

export const OFFER_LABEL: Record<string, string> = {
  landing_page: "Landing page",
  landing_por_procedimento: "Landing por procedimento",
  site_institucional: "Site institucional",
  site_com_agendamento: "Site com agendamento",
  nao_recomendado: "Não recomendado",
};
export const OFFERS = Object.keys(OFFER_LABEL);

export const CONFIDENCE_LABEL: Record<string, string> = {
  baixa: "Confiança baixa",
  media: "Confiança média",
  alta: "Confiança alta",
};
