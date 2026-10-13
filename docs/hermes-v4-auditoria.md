# Auditoria Hermes Prospector — 13/10/2026

## Base existente

Next.js 15, React 19, TypeScript, Tailwind; Supabase Auth/Postgres. Acesso ao painel por `app_admins`, RLS, APIs com tokens SHA-256 e escopos. O service role fica no servidor. Leads, evidências, diagnósticos, contatos, propostas, notas e eventos são persistidos. Normalização brasileira e deduplicação por telefone, Instagram, domínio, identificador e nome/local já existem no banco. Migrações incrementais e testes de banco cobrem as regras.

Pesquisa: skill Hermes + script Python de biblioteca padrão; cidades, nichos, orçamento de buscas, execução exclusiva, pedidos e reposição. Agendamento externo por arquivos BAT. Não há um processo de pesquisa hospedado pelo Next. Pesquisa depende do Hermes e do provedor de busca instalado.

Envio: fila SQL com reserva exclusiva, janelas em São Paulo, limites e confirmação pelo Python. Ponte `whatsapp-web.js`, autenticação local e restrição `ENVIO_SO_PARA`. **A ponte é uma integração Web, não a API oficial Meta.** Não há evidência de autorização de plataforma apenas porque existe sessão conectada.

Conversas: entrada humana/automática, memória com referência de versão, linha do tempo, assumir/devolver atendimento, secretário opcional. Dashboard calcula contagens no banco, evitando truncamento por limites REST.

## Lacunas encontradas antes das alterações

- Prompts excluem qualquer clínica com site; oportunidade e confiança não são pontuadas separadamente.
- Validador da primeira abordagem proíbe página/serviço e obriga elogio; incompatível com A/B/C.
- Secretário proíbe preço, vídeo e links; não identifica interlocutor com evidências nem mantém os vinte estágios solicitados.
- Lembretes usam duas mensagens genéricas após silêncio, sem compromisso confirmado.
- Timeout de envio vira falha, sem distinguir resultado desconhecido de erro confirmado.
- Ponte mantém entradas em memória e remove ao consultar: uma reinicialização ou falha entre leitura e registro pode perder eventos.
- Sem ID externo nas entradas; deduplicação antiga depende de conteúdo e data.
- Não há experimento estratificado, consentimento de vídeo, catálogo oficial nem trilha estruturada de decisões comerciais.
- Limitador HTTP por processo não é compartilhado entre instâncias. Regras críticas de envio devem permanecer no Postgres.
- Histórico fornecido ao secretário limita últimas 40 mensagens. Memória comercial persistida deve complementar esse recorte.

## Preservação e evolução

Adicionar motor comercial interno e tabelas V4; preservar enums antigos, dados e fluxos legados. V4 desligado por padrão, habilitação explícita do canal e elegibilidade por lead. Mensagens comuns são enfileiradas automaticamente; exceções passam apenas a conversa correspondente ao Marcos. Eventos ambíguos não são reenviados. Não confirmar venda/pagamento a partir de texto do cliente.

Os arquivos locais `envio/preparador-loop.bat`, `.new` e `.bak-20261013` já estavam alterados e devem ser preservados.

## Evidência inicial

Antes da implementação: 120 testes Vitest de unidade/API e 20 testes Python do CRM passaram. A suite Python de envio e os testes SQL terão seus resultados registrados no relatório final. Sem disparos reais durante desenvolvimento.

Referência consultada: [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). Changelog consultado em 13/10/2026; mudança TLS anunciada para 10/11/2026 não altera o contrato SQL desta implementação.
