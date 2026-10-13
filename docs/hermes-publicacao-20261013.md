# Publicação do Hermes — 13/10/2026

Painel: https://mktech-prospeccao.vercel.app/comercial

Projeto Vercel `mktech-prospeccao` e Supabase `xdhjlunvgtuxwjqsvqzj`. A publicação incorporou os estilos de mensagem e a retomada de pesquisa que já estavam em produção. Não houve reset do banco real.

Backup dos dados públicos: `backups/hermes-v4-2026-10-13T16-08-23.658Z`, protegido pelo `.gitignore`. Configurações locais anteriores também foram preservadas em `backups/`. Os 70 leads existentes, 46 mensagens legadas e as 45 respostas anteriores foram mantidos; entradas novas legítimas continuam registradas normalmente.

Migrações aplicadas: `hermes_v4`, `catalogo_demonstracoes`, `demo_response_reconciliation`. A aplicação utiliza o catálogo do banco, e a ponte local utiliza a biblioteca relativa ao projeto. A confirmação recente da ponte libera acesso ao arquivo íntegro. O modo teste limita o canal ao telefone interno já configurado, final 0729.

Validações: 466 testes passaram, build local e deploy Vercel concluídos, acesso administrativo autenticado verificado pelo Playwright. A sessão temporária de verificação foi encerrada sem encerrar outras sessões do usuário. Diagnósticos, pesquisas, estilos de mensagem e conversas tiveram regressão preservada.

O contato interno previamente existente recebeu exatamente um link da Polpujá e um vídeo da Rosana. A entrega de ambos foi comprovada por ACK 2, ID canônico real e registro no CRM. As mesmas requisições, após reiniciar a ponte, retornaram o resultado persistido e não criaram novas mensagens. Uma resposta real foi registrada, inclusive após conciliar a confirmação atrasada do vídeo. O contato voltou ao controle manual e não está elegível para novos contatos automáticos.

Correções de compatibilidade da ponte são reaplicadas de forma idempotente ao iniciar. Fontes: [modelo de mídia](https://github.com/wwebjs/whatsapp-web.js/pull/201923), [chave de mensagem](https://github.com/wwebjs/whatsapp-web.js/issues/201857). A tentativa que falhou antes da criação da mídia foi reconciliada por inspeção do histórico. Nenhum resultado desconhecido provocou reenvio automático.

Os serviços rodam ocultos em segundo plano: ponte, worker V4, enviador, secretário legado, pesquisa solicitada e preparador legado. A entrada existente de inicialização continua apontando para `envio/iniciar-tudo.bat`, que agora inclui o worker V4. Sessão WhatsApp, diário e materiais estão em armazenamento local persistente. O computador precisa permanecer ligado para a ponte operar.

Preços oficiais não foram inventados. Sem tabela aprovada para um escopo, o motor encaminha a negociação ao responsável. O envio de demonstrações após autorização do cliente é automático, com bloqueio de duplicatas, sem aprovação individual de Marcos.

O advisor Supabase não apontou tabela V4 sem RLS. Os avisos de funções administrativas `SECURITY DEFINER` acessíveis a usuários autenticados correspondem ao acesso administrativo intencional, com `require_admin` e testes de usuário sem permissão. Avisos anteriores permanecem documentados: [search_path de função legada](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [tabela interna sem políticas públicas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [proteção de senhas comprometidas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Configurações de autenticação existentes não foram alteradas.
