# Menu Spoiler

API REST do **Menu Spoiler**.

Este repositório **não tem interface**: ele existe apenas para expor o banco de dados
através de uma **API REST** — contas, autenticação por sessão e ativação por e-mail.
Qualquer front-end (site ou aplicativo) consome estes endpoints; nada de tela vive aqui.

## Stack

- [Next.js](https://nextjs.org/) API Routes (somente `pages/api`)
- PostgreSQL — [Neon](https://neon.tech/) em produção, Docker em desenvolvimento
- Migrations com [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
- Deploy na [Vercel](https://vercel.com/)
- Jest para testes unitários e de integração

## Requisitos

- Node.js 24 (definido em `engines` no `package.json`)
- Docker e Docker Compose

## Como rodar

O `.env.development` é versionado de propósito: ele só guarda credenciais locais,
então nenhum segredo entra nele. Segredo de verdade vive apenas no painel da Vercel.

```bash
npm install
npm run dev
```

O comando `dev` sobe os serviços no Docker, aguarda o Postgres ficar pronto, aplica as
migrations e inicia a API em <http://localhost:3000>.

Os e-mails de ativação enviados em desenvolvimento não saem para a internet: eles caem no
MailCatcher, que pode ser aberto em <http://localhost:1080>.

Para conferir se subiu tudo:

```bash
curl http://localhost:3000/api/v1/status
```

## Testes

```bash
npm test
```

Os testes de integração sobem a API e conversam com ela de verdade, então precisam dos
serviços do Docker rodando — o próprio `npm test` cuida disso, e para os containers ao
terminar.

## Scripts

| Script                      | O que faz                                           |
| --------------------------- | --------------------------------------------------- |
| `npm run dev`               | Sobe os serviços, roda as migrations e inicia a API |
| `npm test`                  | Roda a suíte completa de testes                     |
| `npm run test:watch`        | Roda os testes em modo watch                        |
| `npm run services:up`       | Sobe apenas os containers                           |
| `npm run services:stop`     | Para os containers                                  |
| `npm run services:down`     | Remove os containers                                |
| `npm run migrations:create` | Cria uma nova migration                             |
| `npm run migrations:up`     | Aplica as migrations pendentes                      |
| `npm run lint:prettier:fix` | Formata o código                                    |
| `npm run commit`            | Commit guiado pelo Commitizen                       |

## API

| Endpoint                               | Descrição                          |
| -------------------------------------- | ---------------------------------- |
| `GET /`                                | Identifica a API                   |
| `GET /status`                          | Atalho para o endpoint de status   |
| `GET /api/v1/status`                   | Status do sistema e do banco       |
| `POST /api/v1/users`                   | Cria uma conta                     |
| `GET /api/v1/users/[username]`         | Dados públicos de um usuário       |
| `PATCH /api/v1/users/[username]`       | Atualiza um usuário                |
| `GET /api/v1/user`                     | Usuário da sessão atual            |
| `POST /api/v1/sessions`                | Login                              |
| `DELETE /api/v1/sessions`              | Logout                             |
| `PATCH /api/v1/activations/[token_id]` | Ativa a conta pelo token do e-mail |
| `GET /api/v1/migrations`               | Lista as migrations pendentes      |
| `POST /api/v1/migrations`              | Aplica as migrations pendentes     |
| `GET /api/v1/tiles/[z]/[x]/[y]`        | Tile vetorial do mapa              |

A sessão é entregue em um cookie `session_id` (`httpOnly`), então o cliente precisa enviar
as requisições com credenciais.

### Tiles do mapa

`GET /api/v1/tiles/[z]/[x]/[y]` devolve um tile vetorial (MVT) do basemap da
[Protomaps](https://protomaps.com/), e é a única rota **pública** da API — ela não passa
pelo middleware de sessão.

A rota existe para que a chave da Protomaps **nunca saia daqui**. Chave embutida em
aplicativo nativo sai do pacote com `unzip` e `strings`, e republicar o aplicativo não a
revoga; na Vercel ela é uma variável de ambiente e a troca é imediata.

Os tiles são recortados para o Brasil a partir do zoom 6 — tile fora da área volta `204`,
sem gastar cota. O `Cache-Control` guarda um dia no aparelho e trinta no CDN, então o
mesmo tile pedido por muita gente bate uma vez só na Protomaps.

O dado é da OpenStreetMap sob **ODbL**, que exige atribuição visível: quem desenha o mapa
precisa mostrar `© OpenStreetMap` na tela.

## Deploy

O banco fica na **Neon** e a API na **Vercel**. Em ambos, entre com **"Continue with
GitHub"**, usando a mesma conta do GitHub onde este repositório está — assim a Vercel
enxerga o repositório na hora de importar e cada push já vira um deploy.

### 1. Banco na Neon

1. Acesse [neon.tech](https://neon.tech/) e faça login com GitHub.
2. Crie um projeto Postgres e copie a connection string do banco.
3. Guarde host, porta, usuário, senha e nome do banco — eles viram variáveis na Vercel.

### 2. API na Vercel

1. Acesse [vercel.com](https://vercel.com/) e faça login com GitHub.
2. Importe este repositório. O Next.js é detectado sozinho, sem configuração de build.
3. Preencha as variáveis de ambiente abaixo e faça o deploy.

### Variáveis de ambiente

| Variável              | De onde vem                                   |
| --------------------- | --------------------------------------------- |
| `POSTGRES_HOST`       | Neon                                          |
| `POSTGRES_PORT`       | Neon (`5432`)                                 |
| `POSTGRES_USER`       | Neon                                          |
| `POSTGRES_PASSWORD`   | Neon                                          |
| `POSTGRES_DB`         | Neon                                          |
| `POSTGRES_CA`         | Opcional — certificado, se quiser fixar o SSL |
| `EMAIL_SMTP_HOST`     | Provedor de e-mail transacional               |
| `EMAIL_SMTP_PORT`     | Provedor de e-mail transacional               |
| `EMAIL_SMTP_USER`     | Provedor de e-mail transacional               |
| `EMAIL_SMTP_PASSWORD` | Provedor de e-mail transacional               |
| `PROTOMAPS_API_KEY`   | Protomaps — chave da API de tiles do mapa     |

Em produção a conexão com o Postgres usa SSL automaticamente; `POSTGRES_CA` só é
necessário se você quiser validar contra um certificado específico.

### 3. Migrations em produção

Depois do primeiro deploy, aplique as migrations chamando o endpoint com um usuário que
tenha a feature `create:migration`:

```bash
curl -X POST https://SEU-DEPLOY.vercel.app/api/v1/migrations \
  -H "Cookie: session_id=SEU_TOKEN"
```

## Commits

O projeto segue [Conventional Commits](https://www.conventionalcommits.org/pt-br/),
validados pelo commitlint — o mesmo check roda no CI sobre todos os commits do pull
request.

```bash
npm run commit   # commit guiado pelo Commitizen
```

## CI e CD

Todo pull request dispara dois workflows no GitHub Actions:

- **Linting** — `prettier --check`, `eslint --max-warnings 0` e `commitlint`
- **Automated Tests** — a suíte completa do Jest

O deploy não passa pelo GitHub Actions: quem cuida dele é a integração da Vercel com o
repositório. Cada pull request ganha um deploy de preview e o merge na `main` vai para
produção.

## Licença

MIT — veja [LICENSE](LICENSE).
