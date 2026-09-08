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
| `npm run places:import`     | Baixa e carrega os estabelecimentos do Overture     |
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

### Estabelecimentos

`GET /api/v1/places/[z]/[x]/[y]` devolve, em JSON, os lugares de comer dentro daquele
tile. Também é **pública**, pelo mesmo motivo dos tiles: o mapa não depende de quem está
olhando, e uma sessão vencida não pode fazer os restaurantes sumirem da tela.

```json
{
  "places": [
    {
      "name": "Pizzaria Calipso",
      "category": "pizza_restaurant",
      "latitude": -23.5351,
      "longitude": -46.4654
    }
  ]
}
```

Endereçada por tile, e não por raio, porque é assim que o aplicativo já pede o mapa — ele
tem cache por tile e descarta o que saiu da tela. Zoom aceito: **14 a 18** (abaixo disso um
tile cobre uma cidade inteira), com teto de 300 lugares por tile.

A rota existe porque o basemap não basta. Os POIs que vêm no tile da Protomaps saem do
OpenStreetMap, e a cobertura dele na periferia é escassa: num raio de 1 km em Itaquera, o
OSM tinha **um** estabelecimento, e o Overture tinha **229** no mesmo lugar.

O dado é do [Overture Maps](https://overturemaps.org/) sob **CDLA-Permissive 2.0** —
licença permissiva, uso comercial liberado e **sem obrigação de atribuição na tela**,
diferente do ODbL do basemap.

O que conta como "lugar de comer" é uma **lista explícita** de categorias na consulta de
`infra/scripts/import-places.sh`, mais o sufixo `_restaurant`. A taxonomia do Overture tem
1508 categorias só no Brasil, e casar por pedaço de nome não funciona: procurar `bar`
traz `barber`, e `pub` traz `public_school` e `notary_public`.

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

### 4. Estabelecimentos em produção

A tabela `places` nasce vazia: a migration cria a estrutura, o dado entra por carga. Não
há rota de escrita para isso de propósito — é uma carga de centenas de milhares de linhas,
feita algumas vezes por ano, e uma rota que aceitasse isso seria um caminho de escrita em
massa aberto na API.

A carga roda **da sua máquina, apontando para a Neon**, e cobre o Brasil inteiro. O único
requisito é o DuckDB (ferramenta de desenvolvimento; não é dependência deste projeto):

```bash
brew install duckdb

POSTGRES_HOST=... POSTGRES_PORT=5432 POSTGRES_USER=... \
POSTGRES_PASSWORD=... POSTGRES_DB=... NODE_ENV=production \
  npm run places:import
```

`NODE_ENV=production` liga o SSL exigido pela Neon.

O DuckDB lê o GeoParquet do Overture direto no S3 e **filtra lá**, trazendo só as cinco
colunas que interessam e só as linhas de comida do Brasil: cerca de **100 MB e dois
minutos**, contra os ~10 GB que o CLI `overturemaps --bbox` baixaria para chegar ao mesmo
resultado — ele traz farmácia, dentista e igreja com todas as propriedades, para filtrar
depois na sua máquina.

O que entra na tabela são ~600 mil estabelecimentos, ocupando cerca de **200 MB** com os
índices. Vale conferir contra o limite de armazenamento do seu plano na Neon.

Para recarregar só uma região, ou outro país, estreite pelo ambiente:

```bash
OESTE=-47 SUL=-24 LESTE=-46 NORTE=-23 npm run places:import
```

O import faz **upsert** por `(source, source_id)` — rodar de novo no release seguinte do
Overture atualiza o que mudou, sem duplicar. Um lugar que sai do dado permanece na tabela
até ser removido à mão.

O release do Overture é fixado no script (`OVERTURE_RELEASE`), para que duas cargas feitas
em semanas diferentes carreguem o mesmo dado. Eles publicam um release por mês;
recarregar a cada poucos meses basta.

**Nada disso roda sozinho**: não há agendamento, pelo mesmo motivo que as migrations
também são disparadas à mão — automatizar exigiria dar credencial de escrita em massa no
banco de produção a um runner de CI, para um job que roda poucas vezes por ano.

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
