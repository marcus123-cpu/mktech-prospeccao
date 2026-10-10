# CRM de prospecção MKTech

Painel para acompanhar a prospecção de clínicas e profissionais de estética
sem site próprio (Fernandópolis, Votuporanga, São José do Rio Preto, Bauru e
Marília), com o Hermes Agent pesquisando e cadastrando candidatos todo dia.

O Hermes **só pesquisa e cadastra**. Ele não manda mensagem, não liga, não
negocia e não marca venda: o token dele não tem permissão para isso e a API
recusa esses campos.

- Painel: Next.js 15 + TypeScript + Tailwind, login pelo Supabase Auth.
- Banco: Supabase (Postgres) com RLS. As regras de duplicado, limites e
  métricas ficam no banco (`supabase/migrations`).
- Hermes: skill em `hermes/skills/mktech-prospeccao` com um script Python
  que só usa a biblioteca padrão.
- Fuso: America/Sao_Paulo em todas as datas, metas e relatórios.

## 1. Instalar no Windows

Pré-requisitos: [Node.js 20 ou 22 LTS](https://nodejs.org), [Git](https://git-scm.com)
e Python 3.10+ (o mesmo que o Hermes usa serve).

```powershell
git clone https://github.com/marcus123-cpu/mktech-prospeccao.git
cd mktech-prospeccao
npm install
copy .env.example .env.local
notepad .env.local
```

No `.env.local`, preencha com os valores de **Supabase > Project Settings > API**
do projeto `mktech-prospeccao`:

| Variável | Onde pegar | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | já vem preenchida | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` / publishable | pode ir ao navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` / secret | **só no servidor**, nunca compartilhe |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` ou o endereço publicado | link de recuperação de senha |

O `.env.local` está no `.gitignore`. Não cole essas chaves em chat, print ou commit.

### Jeito fácil: Docker (fica ligado sozinho)

1. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   e, nas configurações dele, marque *Start Docker Desktop when you sign in*.
2. Dê dois cliques em **`iniciar-painel.bat`** na pasta do projeto. Na
   primeira vez ele demora alguns minutos para montar; depois abre
   http://localhost:3000 sozinho.

O painel continua ligado mesmo fechando a janela, e volta sozinho quando o
PC reinicia (desde que o Docker Desktop abra com o Windows). Para desligar,
rode **`parar-painel.bat`**. Rodar `iniciar-painel.bat` de novo também
baixa e aplica as atualizações do GitHub.

### Sem Docker

```powershell
npm run build
npm run start      # painel em http://localhost:3000
```

Para desenvolver, `npm run dev`.

## 2. Configurar o Supabase (uma vez)

O banco já foi criado com todas as migrações, exceto a de exclusão de lead.

1. **Desligar cadastro público:** Authentication > Sign In / Providers >
   desmarque *Allow new users to sign up*.
2. **Endereços de retorno:** Authentication > URL Configuration. Em *Site URL*
   coloque o `NEXT_PUBLIC_SITE_URL`. Em *Redirect URLs* adicione
   `http://localhost:3000/auth/callback` (e o endereço publicado, se houver).
3. **Criar o seu usuário:** Authentication > Users > *Add user* > *Create new user*,
   com seu e-mail e senha, marcando *Auto Confirm User*.
4. **Tornar o usuário administrador:** SQL Editor, rode:
   ```sql
   insert into public.app_admins (user_id)
   select id from auth.users where email = 'seu-email@exemplo.com';
   ```
   Só quem está em `app_admins` enxerga e altera dados. Um usuário logado que
   não esteja lá não vê nada.
5. **(Opcional) Exclusão de lead (LGPD):** cole no SQL Editor o conteúdo de
   `supabase/migrations/20261009000900_exclusao_lgpd.sql`. Sem ela, o botão
   de excluir lead mostra erro; o resto funciona.

## 3. Usar o painel

- **Painel:** cadastros, contatos, respostas, propostas e fechamentos do
  período, com taxas por coorte (quem foi contatado no período e respondeu
  depois). Sem base de cálculo, a taxa aparece como "—".
- **Leads:** busca e filtros por cidade, etapa, origem, prioridade, site, não contatados e período;
  ações em lote; exportação CSV.
- **Detalhe do lead:** linha do tempo com cadastro, evidências, contatos,
  mudanças de etapa, notas e propostas. Contato errado se corrige com
  "Corrigir"; o registro antigo fica no histórico como anulado.
- **Duplicados:** fila de possíveis duplicados para juntar ou manter separado.
- **Retornos:** follow-ups vencidos e da semana.
- **Execuções:** cada rodada do Hermes, com buscas, aprovados, descartados,
  erros e motivo do fim.
- **Configurações:** meta diária (padrão 20), cidades, nichos, limites, rotina
  ligada/pausada e tokens de integração.

### Importar a planilha atual

1. No Excel/Google Sheets, exporte como **XLSX** ou **CSV**.
2. Leads > Importar > escolha o arquivo.
3. Confira o mapeamento das colunas (Cliente, Telefone/WhatsApp, Contatado?,
   Cidade, Instagram, Link do WhatsApp, Verificação de site, Observações).
4. Veja a prévia: quantos serão criados, quantos já existem, quantos vão para
   revisão e quais linhas têm problema.
5. Confirme. Importar o mesmo arquivo de novo não duplica nada.

Regras da importação: "Sim" em *Contatado?* vira contato realizado **sem
data**; vazio fica como não informado. Texto ambíguo em *Verificação de site*
fica como "verificação pendente", nunca como "sem site". Observações como
"não atua mais na área" marcam o lead como desqualificado. O telefone
original é guardado como foi digitado.

## 4. Conectar o Hermes

### 4.1 Criar o token

Configurações > Credenciais da integração > *Criar token*. O token (`mkt_...`)
aparece **uma vez só**. Ele permite apenas: ler configurações, consultar
duplicados, cadastrar candidatos e registrar execuções. Se vazar, revogue
na mesma tela e crie outro.

### 4.2 Instalar a skill

No PowerShell, dentro da pasta do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\hermes\instalar-skill.ps1
```

O script procura a pasta do Hermes (`HERMES_HOME`, depois
`%LOCALAPPDATA%\hermes`, depois `%USERPROFILE%\.hermes`), pede confirmação,
copia a skill para `<pasta>\skills\mktech\mktech-prospeccao`, pede a URL do
CRM e o token (sem mostrar na tela) e grava num `.env` só da skill. Ele **não
mexe no `config.yaml`** e não sobrescreve uma instalação existente sem
`-Force`. No fim roda o `selftest`.

Se o Hermes estiver em outra pasta: `-HermesHome "C:\caminho\hermes"`
(`hermes status` mostra qual é).

### 4.3 Busca na web gratuita

O Hermes precisa de uma ferramenta de busca web para pesquisar. Sem ela, a
execução termina como `falhou` e nenhum lead é inventado.

Opções sem custo, segundo a documentação atual do Hermes: **DDGS**
(DuckDuckGo, sem chave; precisa do pacote `ddgs` no Python do Hermes) ou
**Brave Search** no plano gratuito (precisa de chave). Configure em
`hermes tools`. Sua versão (v0.21) é mais antiga que a documentação, então
confira se a opção aparece antes de contar com ela.

### 4.4 Teste manual (obrigatório antes da rotina)

```powershell
hermes -z "Use a skill mktech-prospeccao para uma execução manual de teste (start-run --manual) só em Votuporanga, com no máximo 3 cadastros. Não envie mensagens a ninguém."
```

Depois confira no painel, em **Execuções** e **Leads** (origem Hermes), se os
cadastros têm evidências reais e se nada foi duplicado. Para testar só a
conexão: `python "<pasta da skill>\scripts\mktech_crm.py" selftest`.

### 4.5 Rotina diária (fica pausada até você ligar)

A rotina tem duas travas: o agendamento do Hermes e o botão "Rotina diária"
em Configurações. Com o botão desligado, o script recusa execuções
agendadas (só aceita `--manual`).

1. Confira os parâmetros na sua versão: `hermes cron create --help`.
2. Crie o agendamento **pausado**, às 9h:
   ```powershell
   hermes cron create "0 9 * * *" "Use a skill mktech-prospeccao para a prospecção diária. Não envie mensagens a ninguém." --skill mktech-prospeccao --name mktech-prospeccao-diaria --paused --deliver local
   ```
3. O agendador do Hermes só roda com o gateway ligado: `hermes gateway`
   (ou `hermes gateway install` para iniciar com o Windows). O seu gateway
   tem WhatsApp e Telegram configurados; desative as ferramentas de mensagem
   para tarefas agendadas em `hermes tools`, se a sua versão permitir.
4. Para garantir o horário de Brasília, defina `HERMES_TIMEZONE=America/Sao_Paulo`
   e confira o próximo horário em `hermes cron list`.
5. **Ligar:** Configurações > Rotina diária > ligada, e
   `hermes cron resume mktech-prospeccao-diaria`.
6. **Pausar:** desligue o botão no painel (efeito imediato) e/ou
   `hermes cron pause mktech-prospeccao-diaria`.
7. **Acompanhar:** página Execuções no painel, `hermes cron list` e
   `hermes cron status`.

Limites que o banco garante, mesmo se o agente errar: no máximo a meta diária
de cadastros por dia (horário de SP), uma execução aberta por vez, execução
recusada depois do tempo máximo, e repetição de chamada não duplica lead.

## 5. Onde roda cada parte

- **Banco:** Supabase, plano gratuito. Projetos gratuitos pausam depois de
  uma semana sem uso; reative no painel do Supabase se acontecer.
- **Painel:** no seu PC, pelo Docker (`iniciar-painel.bat`) ou
  `npm run start`. O Hermes, no mesmo PC, usa `http://localhost:3000`. O
  Docker só aceita acesso deste computador. Para abrir do celular seria
  preciso publicar (ex.: Vercel); o plano gratuito Hobby da Vercel é para uso
  não comercial, então confira os termos antes.
- **Hermes:** no seu PC. A rotina só roda com o PC ligado e o gateway ativo.

## 6. Backup e restauração

- **Exportação rápida:** Leads > Exportar CSV (abre no Excel com acentos).
- **Backup completo do banco** (precisa do PostgreSQL client instalado; a
  senha do banco fica em Supabase > Project Settings > Database):
  ```powershell
  pg_dump "postgresql://postgres.xdhjlunvgtuxwjqsvqzj:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" --schema=public --format=custom --file "backup-crm-$(Get-Date -Format yyyy-MM-dd).dump"
  ```
  Copie a string exata em Supabase > Connect > Session pooler. Guarde o
  arquivo fora da pasta do projeto (ele tem dados pessoais dos leads).
- **Restaurar** (num projeto novo ou após um problema):
  ```powershell
  pg_restore --clean --if-exists --no-owner --dbname "<string de conexão>" backup-crm-AAAA-MM-DD.dump
  ```
  Os usuários de login (`auth.users`) não entram nesse backup; recrie o
  admin pelo passo 2.3 e 2.4.

## 7. Testes

```powershell
npm run test:unit                      # importação, datas, contrato e rotas da API
python -m unittest discover -s hermes/tests   # script do Hermes contra servidor falso
npm run build; npm run check:secrets   # nenhum segredo no código do navegador
```

Os testes do banco (`npm run test:db`) usam um Postgres 16 local e o script
`tests/db/reset.sh` (bash); rodam no Linux/WSL.

Resultado na última execução: 35 testes de banco (duplicados por telefone,
Instagram, nome parecido, unidade e fonte; idempotência e concorrência;
reentrada de desqualificado; correção de contato; métricas por coorte; fuso;
importação; permissões de token e de usuário; limites de execução), 28 testes
de unidade e de rotas da API e 13 testes do script Python, todos passando.
O instalador PowerShell não foi executado num Windows real ainda.

## Estrutura

```
src/app/(painel)/        páginas do painel (login obrigatório)
src/app/api/hermes/v1/   API do Hermes (token Bearer mkt_...)
src/lib/                 regras do painel, importação, datas, cliente Supabase
supabase/migrations/     banco: tabelas, duplicados, API, métricas, RLS
hermes/skills/           skill e script do Hermes
hermes/instalar-skill.ps1
tests/                   testes de banco, unidade e API
```

## Envio automático (WhatsApp)

Tela **Envio automático** no painel. Fluxo:

1. O Hermes escreve a primeira mensagem de cada lead com diagnóstico
   (`mktech_crm.py envio-pendentes` / `envio-salvar`). A API valida (elogio
   concreto, dor e melhoria vindos dos dados, sem texto técnico/erro, sem
   fato inventado). Mensagem recusada não entra na fila; com 3 recusas o lead
   aparece em "Precisa de atenção".
2. O enviador do PC (`envio/mktech_envio.py rodar`) pede ao servidor a
   próxima etapa. O servidor decide: chave global (nasce **desligada**),
   pausa, horário e dias (São Paulo), limite diário e espera sorteada entre
   leads. Primeiro sai a saudação (bom dia / boa tarde / boa noite), depois a
   mensagem. Etapa não confirmada em 5 minutos vira "falhou" e não é reenviada.
3. Respostas são classificadas em automática ou pessoa. Só pessoa move o lead
   para "respondeu"; pedido para parar bloqueia o lead. Ninguém responde o
   cliente sozinho.

A tela **Funil** mostra cada lead numa coluna: Na fila, Enviado, Em conversa,
Pergunta de valor (uma pessoa perguntou preço; quem responde é você), Fechando
(proposta enviada) e Fechado. Ela só mostra; nada é respondido ao cliente.

Configuração no PC: copie `envio/.env.exemplo` para `envio/.env`, crie o
token do enviador na tela e rode `envio/rodar-envio-simulacao.bat`. O
transporte `whatsapp` (envio real) ainda não está ligado nesta versão.
