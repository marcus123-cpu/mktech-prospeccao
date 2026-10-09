import type { ApproachContext } from "@/lib/approach";

// Dados reais de 09/10/2026 (resumidos) dos dois leads do teste manual.
export const adriele: ApproachContext = {
  business_name: "Adriele Alarcon Estética",
  responsible_name: "Adriele Alarcon",
  niche: "estética facial",
  city: "Fernandópolis",
  state: "SP",
  services: ["limpeza de pele", "microagulhamento facial e labial", "peelings", "avaliação facial"],
  site_status: "verificacao_pendente",
  pending_items:
    "Confirmar se possui domínio próprio não indexado e se permanece no endereço divulgado em 2025; Instagram direto exige login.",
  website_url: null,
  instagram_handle: "adrielealarcon",
  phone_e164: "+5517997562775",
  selection_reason: "Espaço de estética facial documentado em Fernandópolis; perfil público ativo em outubro de 2026 com convite a avaliações e agendamento por telefone.",
  diagnosis: {
    confidence: "media",
    summary: "Profissional de estética facial em Fernandópolis, com atividade pública recente e avaliação facial divulgada.",
    pains: [
      { pain: "Informações de procedimentos e avaliação dispersas entre notícia antiga e posts sociais", evidence: "Notícia local lista serviços em 2025; Threads de 28/09/2026 convida à avaliação sem página própria de serviço localizada." },
      { pain: "Dependência de canal social/telefone para descoberta e agendamento pode limitar informação prévia", evidence: "Post de 03/10/2026 fornece telefone como chamada à ação; não foi encontrada página própria de agendamento." },
    ],
  },
  evidences: [
    { kind: "outro", url: "https://www.canaldez.com.br/noticia/3570/adriele-alarcon-esteticista-inaugura-espaco-de-estetica-facial", summary: "Notícia de 20/05/2025 identifica espaço na Av. Milton Terra Verdi, 551, Fernandópolis, e lista limpeza, microagulhamento, peelings, rejuvenescimento e acne.", limitation: "Endereço e portfólio publicados em 2025; não reconfirmados presencialmente." },
    { kind: "outro", url: "https://www.threads.com/@adrielealarcon", summary: "Perfil público declara esteticista e cosmetóloga com foco facial; posts de 28/09, 02/10 e 03/10/2026 tratam de avaliação facial, pele e agendamento por telefone." },
    { kind: "busca", url: null, summary: "Buscas pelo nome comercial trouxeram notícia e redes, sem domínio próprio atribuível." },
  ],
  notes: [],
};

export const dheinyfer: ApproachContext = {
  business_name: "Instituto Dheinyfer Valeretto",
  responsible_name: "Dheinyfer Valeretto",
  niche: "harmonização facial",
  city: "Fernandópolis",
  state: "SP",
  services: ["harmonização facial full face", "estética facial"],
  site_status: "verificacao_pendente",
  pending_items:
    "Verificar se há domínio próprio não indexado e se a unidade ainda atende em Fernandópolis; confirmar o destino final da página Canva de agendamento, cujo acesso retornou 403.",
  website_url: "https://dradheinyfervaleretto.com.br",
  instagram_handle: "dradheinyfervaleretto",
  phone_e164: null,
  selection_reason: "Instituto de harmonização facial; link público de agendamento redireciona para Canva.",
  diagnosis: {
    confidence: "media",
    summary: "Instituto local de harmonização facial com presença social ativa.",
    pains: [
      { pain: "Dependência de link curto e plataforma de terceiros para apresentar o atendimento", evidence: "Bio pública usa bit.ly/DraDheinyfer, que redirecionou para visualização Canva." },
    ],
  },
  evidences: [
    { kind: "outro", url: "https://www.threads.com/@dradheinyfervaleretto", summary: "Perfil público de cirurgiã-dentista com link de agendamento; post de 01/10/2026 confirma atividade recente." },
    { kind: "busca", url: "https://bit.ly/DraDheinyfer", summary: "Link de agendamento da bio redirecionou para página de visualização no Canva, não para domínio próprio da clínica." },
  ],
  notes: ["Marcos confirmou: tem site em dradheinyfervaleretto.com.br; o link antigo da bio apontava para o Canva."],
};
