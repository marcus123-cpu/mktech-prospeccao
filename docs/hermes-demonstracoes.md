# Biblioteca comercial do Hermes

Pasta final: `hermes/videos-demonstracao`, relativa à raiz do projeto.

| ID | Material | Destino recomendado |
|---|---|---|
| DEMO_ROSANA_LANDING | `landing-pages/rosana-landing-page.mp4` | Landing page, portfólio, procedimentos |
| DEMO_POLPUJA_VITRINE | https://www.xn--polpuj-uta.com.br/ | Site vitrine, institucional, produtos |

O caminho originalmente informado não existia. O vídeo de computador foi localizado em `C:\Users\pmarc\Documents\Landing pages\videos\Rosana - landing page (computador).mp4`. O original foi preservado. A cópia tem 16.811.191 bytes, 49,233 segundos, H.264, 1440 × 900, sem faixa de áudio. SHA-256 original/cópia: `8d835abcabc68280eb3fcf5316374be939ec45d752f96bcf39fcacff42d22ab7`. A decodificação completa pelo FFmpeg terminou sem erros, e quadros foram inspecionados. O Playwright reproduziu a cópia no navegador, com 42 quadros decodificados, dimensões e duração corretas e nenhum erro de mídia. `MessageMedia.fromFilePath` da biblioteca WhatsApp Web também leu os 16.811.191 bytes como `video/mp4`.

Polpujá respondeu HTTP 200. Playwright verificou apresentação e navegação para produtos, inclusive em viewport móvel de 390 px, sem transbordamento horizontal. O endpoint de sessão de cliente retornou 401 para visitante sem login; as páginas públicas carregaram. A biblioteca descreve somente o que foi observado, sem prometer funcionamento de pagamento ou pedidos.

O motor seleciona o material pelo catálogo, oferece o exemplo e aguarda autorização contextual do cliente. Um “sim” sem oferta anterior não autoriza envio. Não exige aprovação de Marcos a cada envio. As regras globais de canal, teste, horário, opt-out e controle manual continuam aplicadas. Oferta, autorização, envio confirmado e resposta ficam em `lead_demonstrations`; a fila armazena o ID do material e impede uma segunda tentativa automática, inclusive após resultado desconhecido. A ponte mantém também um diário persistente dos IDs enviados.

## Instalação e armazenamento

As migrações V4, catálogo e `20261013165000_demo_response_reconciliation.sql` foram aplicadas ao Supabase de produção em 13/10/2026. O painel está publicado em https://mktech-prospeccao.vercel.app/comercial. Os 70 leads existentes e históricos foram preservados. A biblioteca está no projeto; o serviço de envio local lê o caminho relativo mesmo após reiniciar e independente do diretório atual. A aplicação web hospedada recebe apenas os metadados do banco; o vídeo fica acessível à ponte que efetivamente envia as mensagens.

Para hospedar a ponte em outro ambiente, levar **toda** a pasta `videos-demonstracao` para um volume persistente e configurar `HERMES_DEMO_ROOT` com o ponto de montagem. Preservar também a sessão WhatsApp e `BRIDGE_JOURNAL_PATH` em armazenamento persistente. Instalar Google Chrome completo e definir `BRIDGE_CHROME_PATH` em ambientes sem detecção automática. Chromium padrão pode não reproduzir H.264. Não basta levar apenas o painel Next.js. A fila de vídeo exige uma confirmação recente de acesso feita pela ponte: sem arquivo íntegro no serviço, o envio não é liberado.

Adicionar novos materiais ao `catalogo.json` com ID único `DEMO_...`, tipo, escopos, termos de seleção, oferta, legenda e aprovação. Vídeos exigem caminho relativo, tamanho e SHA-256. Executar `node scripts/sync-demonstrations.mjs` para validar; depois `node scripts/sync-demonstrations.mjs --apply` para sincronizar metadados no banco configurado em `.env.local`. Isso permite ampliar a biblioteca sem editar o prompt. Não colocar credenciais no catálogo.

## Verificação

`npm run test:bridge` verifica biblioteca real, integridade, preparação de vídeo/link, indisponibilidade e persistência contra duplicação. `tests/db/demonstrations.test.ts` verifica o fluxo oferta → autorização → fila → confirmação → histórico, remoção do material e repetição. `tests/unit/demonstrations.test.ts` verifica seleção e consentimento.

Além dos testes isolados, vídeo e link foram enviados ao contato interno já existente, “Clínica Teste”, no telefone configurado de final 0729. Ambos tiveram confirmação de entrega (ACK 2) verificada na sessão WhatsApp e gravada no CRM. Depois de reiniciar a ponte, repetir as mesmas requisições retornou os resultados persistidos: o histórico continuou com exatamente um vídeo e um link. A resposta real do contato também foi registrada. O contato de teste voltou ao controle manual e ficou inelegível para novos contatos automáticos.

A validação real revelou dois problemas do pacote WhatsApp Web 1.34.7: colisão do ID interno do modelo de mídia e renomeação de `_serialized` para `$1`. A ponte aplica correções estreitas e idempotentes no início, documentadas em [correção de mídia upstream](https://github.com/wwebjs/whatsapp-web.js/pull/201923) e [retorno do ID da mensagem](https://github.com/wwebjs/whatsapp-web.js/issues/201857). A primeira tentativa de vídeo falhou antes de criar a mensagem e foi cancelada após inspeção do histórico. Os envios que foram entregues com retorno indefinido foram conciliados pelo ID real; não foram repetidos. O vídeo original e a cópia permanecem intactos.

O worker V4, enviador, ponte e rotinas existentes estão em segundo plano. `ENVIO_SO_PARA` e o modo teste restringem o canal ao telefone interno. Preços oficiais continuam dependentes de cadastro aprovado: o motor encaminha uma pergunta sem tabela, em vez de inventar valores.
