# Menu Spoiler

API REST, site institucional, painel administrativo web e páginas auxiliares em
links de e-mail e compartilhamento do **Menu Spoiler**.

O repositório centraliza a autenticação por sessão, o banco de dados, o painel em
`/admin` para gestão operacional e a página inicial institucional com os links das
lojas. Não há versão pública web dos cardápios: links compartilhados em
`/cardapio/[place_id]` abrem o aplicativo instalado (Universal/App Links) ou
direcionam à Google Play Store e à Apple App Store.

## Stack

- [Next.js](https://nextjs.org/) (API Routes em `pages/api` e páginas em `pages/`)
- [MapLibre GL](https://maplibre.org/) no mapa do painel administrativo
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

| Script                        | O que faz                                                           |
| ----------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                 | Sobe os serviços, roda as migrations e inicia a API                 |
| `npm test`                    | Roda a suíte completa de testes                                     |
| `npm run test:watch`          | Roda os testes em modo watch                                        |
| `npm run services:up`         | Sobe apenas os containers                                           |
| `npm run services:stop`       | Para os containers                                                  |
| `npm run services:down`       | Remove os containers                                                |
| `npm run migrations:create`   | Cria uma nova migration                                             |
| `npm run migrations:up:dev`   | Aplica as migrations no banco local                                 |
| `npm run migrations:up`       | Aplica as migrations lendo `POSTGRES_*` do ambiente                 |
| `npm run places:import`       | Baixa e carrega os estabelecimentos do Overture                     |
| `npm run places:manual`       | Importa estabelecimentos manuais de `infra/data/manual-places.json` |
| `npm run admin:promote`       | Concede todas as permissões admin a um usuário existente            |
| `npm run admin:seed:dev`      | Cria ou atualiza a conta admin de desenvolvimento local             |
| `npm run lint:prettier:check` | Verifica formatação com Prettier                                    |
| `npm run lint:prettier:fix`   | Formata o código                                                    |
| `npm run lint:eslint:check`   | Executa ESLint com zero avisos tolerados                            |
| `npm run commit`              | Commit guiado pelo Commitizen                                       |

## API e rotas web

| Rota / Endpoint                                | Descrição                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /`                                        | Site institucional com logotipo e botões das lojas                        |
| `GET /cardapio/[place_id]`                     | Fallback web do link compartilhado (apenas nome e atalhos às lojas)       |
| `GET /conta/confirmar-email/[token]`           | Confirmação de troca de e-mail com opção de enviar link de senha          |
| `GET /cadastro/ativar/[token]`                 | Página do link de ativação, que só encaminha ao aplicativo                |
| `GET /senha/recuperar/[token]`                 | Página do link de recuperação, que só encaminha ao aplicativo             |
| `GET /privacidade`                             | Política de privacidade                                                   |
| `GET /admin`                                   | Central administrativa unificada (locais, sugestões, suporte, contas)     |
| `GET /admin/login` e `/admin/recuperar-senha`  | Autenticação, recuperação de senha e entrada administrativa               |
| `GET /admin/estabelecimentos/[id]`             | Edição detalhada de estabelecimento, mapa e cardápio                      |
| `GET /admin/usuarios/[id]`                     | Ficha detalhada de usuário, troca de dados, cargo e auditoria             |
| `GET /status`                                  | Atalho para o endpoint de status                                          |
| `GET /api/v1/status`                           | Status do sistema e do banco                                              |
| `POST /api/v1/users`                           | Cria uma conta                                                            |
| `GET /api/v1/users/[username]`                 | Dados de outro usuário (sessão)                                           |
| `PATCH /api/v1/users/[username]`               | Troca o nome de um usuário                                                |
| `GET /api/v1/user`                             | Usuário da sessão atual                                                   |
| `DELETE /api/v1/user`                          | Apaga a conta da sessão atual e anonimiza solicitações de suporte         |
| `PATCH /api/v1/user/password`                  | Troca a senha da sessão atual                                             |
| `PATCH /api/v1/user/username`                  | Troca o nome da sessão atual                                              |
| `POST /api/v1/sessions`                        | Login no aplicativo                                                       |
| `DELETE /api/v1/sessions`                      | Logout no aplicativo                                                      |
| `PATCH /api/v1/activations/[token_id]`         | Ativa a conta pelo token do e-mail                                        |
| `POST /api/v1/recoveries`                      | Pede o link de "esqueci a senha"                                          |
| `PATCH /api/v1/recoveries/[token_id]`          | Grava a senha nova de quem abriu                                          |
| `GET /api/v1/recoveries/without-email`         | Estrutura pública do questionário de recuperação sem e-mail               |
| `POST /api/v1/recoveries/without-email`        | Avalia recuperação sem acesso ao e-mail antigo ou encaminha ao suporte    |
| `GET / PATCH /api/v1/email-changes/[token_id]` | Valida ou confirma troca de e-mail (e senha opcional)                     |
| `GET /api/v1/support/info`                     | Orientações de ajuda e canal oficial de contato                           |
| `POST / GET /api/v1/support/requests`          | Envia pedido de local/ajuda (público) ou lista pedidos da sessão          |
| `GET /.well-known/assetlinks.json`             | App Links do aplicativo Android                                           |
| `GET /.well-known/apple-app-site-association`  | Universal Links do aplicativo iOS                                         |
| `GET /api/v1/migrations`                       | Lista as migrations pendentes                                             |
| `POST /api/v1/migrations`                      | Aplica as migrations pendentes                                            |
| `GET /api/v1/tiles/[z]/[x]/[y]`                | Tile vetorial do mapa                                                     |
| `GET /api/v1/places/[z]/[x]/[y]`               | Lugares de comer dentro de um tile                                        |
| `GET /api/v1/places?q=`                        | Busca de lugares por nome                                                 |
| `POST /api/v1/suggestions`                     | Sugere um lugar ou uma mudança                                            |
| `GET /api/v1/suggestions`                      | As próprias sugestões, ou a fila                                          |
| `PATCH /api/v1/suggestions/[id]`               | Aceita ou recusa uma sugestão                                             |
| `POST /api/v1/menus`                           | Manda o cardápio de um lugar                                              |
| `GET /api/v1/menus?place_id=`                  | O cardápio que vale para um lugar                                         |
| `GET /api/v1/menus/places`                     | Os lugares que têm cardápio                                               |
| `GET /api/v1/user/menus`                       | Os cardápios que a conta mandou                                           |
| `POST /api/v1/vision/read`                     | Lê a foto de um cardápio                                                  |
| `/api/v1/admin/*`                              | Sessão, locais, cardápios, usuários e solicitações do painel `/admin`     |
| `GET /api/v1/cron/cleanup`                     | Limpeza diária de tokens, sessões e rate limits expirados (`CRON_SECRET`) |

A sessão é entregue em um cookie `session_id` (`httpOnly`), e o token também vem no corpo
do `POST /api/v1/sessions` — o aplicativo nativo lê dali e manda `Cookie: session_id=<token>`
nas chamadas seguintes, como o Pindorama faz com o judhagsan.

O login aceita **5 tentativas por IP a cada 15 minutos** (`429` com `Retry-After` depois
disso), e cada sessão criada, recusada ou encerrada fica em `audit_logs` — os dois vieram do
repositório judhagsan. `GET /api/v1/users/[username]` exige sessão e não devolve `features`:
a lista é o mapa de privilégios da conta, e cada um lê a sua por `GET /api/v1/user`.

### Criar a conta

`POST /api/v1/users` aceita **5 cadastros por IP a cada hora**: cada um manda um email do
nosso domínio para o endereço que veio no corpo, e sem teto a rota enchia a caixa de
qualquer um. A resposta é **a mesma** (`201` com uma frase) para o email novo e para o que
já tem conta, e leva o mesmo tempo — no repetido a senha também passa pelo bcrypt. Quem
fica sabendo da tentativa é o dono do email, por um aviso, e ela fica em `audit_logs`
(`user.signup_duplicate_email`). O nome de usuário repetido continua respondendo `400`: o
nome não é segredo, e sem isso não haveria como escolher outro.

Os emails da conta não levam o nome de usuário: quem cadastra escolhe o nome, e o email
pode ser de outra pessoa — com o nome no texto, qualquer um poria a frase que quisesse no
começo de um email assinado por `contato@menuspoiler.com.br`.

### Trocar a senha

`PATCH /api/v1/user/password` `{ current_password, password }` troca a senha de quem está
com a sessão. Pede a senha **atual**, e não só a sessão: quem pega um aparelho
desbloqueado tem a sessão, e sem isso ficaria com a conta. A nova tem de 8 a 72
caracteres (o teto é o do bcrypt, em bytes) e não pode ser a mesma.

As **outras** sessões da conta são encerradas na mesma instrução; a que pediu continua.
A senha atual errada responde `400`, e não `401` — para o aplicativo, `401` é sessão
morta. O limite é o do login: cinco tentativas por IP a cada quinze minutos.

### Trocar o nome de usuário

`PATCH /api/v1/user/username` `{ username }` troca o nome de quem está com a sessão, e
responde com a conta como o `GET /api/v1/user` a devolve. O nome chega sem os espaços das
pontas, com 1 a 30 caracteres, e não pode ser o mesmo de agora. Um nome de outra conta é
recusado sem distinguir maiúsculas, como no cadastro; mudar só as maiúsculas do próprio
nome vale.

Não pede a senha: o nome não abre a conta. O limite é de **10 tentativas por IP a cada 15
minutos**, porque cada resposta diz se um nome está em uso, e sem teto a rota serviria
para levantar a lista de contas. A troca fica em `audit_logs` como
`user.username_changed`.

`PATCH /api/v1/users/[username]` troca **só o nome**, pelas mesmas regras: o da própria
conta, ou o de outra para quem tem `update:user:others`. Qualquer outro campo no corpo
responde `400`: a senha se troca por `PATCH /api/v1/user/password`, e alterações de e-mail
seguem apenas os fluxos dedicados de administração (`/api/v1/admin/users/[id]`),
confirmação por token (`/api/v1/email-changes/[token_id]`) ou recuperação sem e-mail.
Essa rota não tem o limite de tentativas.

### Apagar a conta

`DELETE /api/v1/user` apaga a conta de quem está com a sessão — só a própria: quem é a
conta sai da sessão, e não do endereço.

Apagar é **esvaziar**, e não remover a linha. Nome de usuário, email e senha viram nulos (e
ficam livres para outra pessoa usar), as features somem, as sessões e os links de ativação
são apagados, e o IP sai dos registros de auditoria dela. Fica o `id`, com `deleted_at`.

**Os cardápios e as sugestões que a conta mandou não são apagados.** O cardápio é do
lugar, e não de quem o fotografou: ele continua valendo e continua aparecendo no
aplicativo. Ele ainda aponta para a conta, que já não identifica ninguém — e é isso que
permite limpar de uma vez o que uma mesma conta mandou. Os termos de uso do aplicativo
dizem isso a quem apaga.

### Ativação no aplicativo

O e-mail de cadastro leva a `https://menuspoiler.com.br/cadastro/ativar/<token>`, e quem
ativa a conta é o **aplicativo**, com `PATCH /api/v1/activations/[token_id]`. No celular
com o Menu Spoiler instalado, o sistema entrega o link direto a ele, e para isso o domínio
declara o aplicativo:

- `public/.well-known/assetlinks.json` — App Links do Android: o pacote e a impressão
  digital SHA-256 do certificado que assina o APK. Hoje é a chave de desenvolvimento;
  a da loja entra na mesma lista quando o aplicativo for publicado (no Google Play, a
  do _App Signing_, que o Play Console mostra).
- `public/.well-known/apple-app-site-association` — Universal Links do iOS para
  `UFT3B28989.com.menuspoiler.app`, cobrindo `/cadastro/ativar/*`, `/senha/recuperar/*` e
  `/cardapio/*`, servido com `Content-Type: application/json` pelo `next.config.js`.

O Android só confere os arquivos de associação se vierem do próprio domínio, em `https` e
**sem redirecionamento** — o domínio principal na Vercel tem de ser `menuspoiler.com.br`,
e não o `www`. As páginas com token na URL enviam `Referrer-Policy: no-referrer`.

A página `pages/cadastro/ativar/[token].js` é para quem abre o link em outro lugar — no
computador, ou num celular sem o aplicativo. Ela explica onde abrir e, no Android, oferece
abrir o aplicativo por `intent://`. **Ela nunca ativa a conta**: ativar pela web é o fluxo
que se decidiu não ter, e um pré-visualizador de links que buscasse o endereço gastaria o
token no lugar da pessoa.

### Recuperação de senha

Quem esqueceu a senha pede um link por e-mail, e escolhe a senha nova **no aplicativo** —
o mesmo desenho da ativação.

- `POST /api/v1/recoveries` `{ email }` manda o link, se houver conta com o e-mail. A
  resposta é **a mesma** com e sem conta, para não revelar quem tem cadastro. Sem sessão
  e sem feature; o que segura o abuso é o limite de cinco pedidos por IP a cada quinze
  minutos.
- O e-mail leva a `https://menuspoiler.com.br/senha/recuperar/<token>`, que o sistema
  entrega ao aplicativo. A página `pages/senha/recuperar/[token].js` é para quem abre em
  outro lugar, e **nunca troca a senha** — é a mesma peça da página de ativação
  (`components/AbrirNoAplicativo.js`).
- `PATCH /api/v1/recoveries/[token_id]` `{ password }` grava a senha nova. O token é a
  credencial inteira: vale por quinze minutos e uma vez só. A senha segue a regra de 8 a
  72 da troca de senha.

Trocar por aqui gasta o link e os outros links pendentes da conta, e encerra **todas** as
sessões dela — quem esqueceu a senha não está dentro, e quem recupera porque perdeu a
conta para alguém quer esse alguém fora. Recuperar não ativa: a conta que nunca abriu o
link de ativação troca a senha e continua sem poder entrar.

Trocar a senha pelo caminho normal (`PATCH /api/v1/user/password`) também gasta os links
pendentes, e apagar a conta os apaga.

O que a rota de pedir não esconde: com conta, ela manda um e-mail antes de responder, e
demora mais. E se o serviço de e-mail estiver fora, ela responde erro só para quem tem
conta.

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

O tile não sai como a Protomaps o entrega. As camadas que o aplicativo não desenha
(`pois` e `places`) são tiradas, e a resposta vai em **gzip** para quem manda
`Accept-Encoding: gzip` — a borda da Vercel não comprime este tipo de conteúdo sozinha.
Medido em tiles de z15 de São Paulo, o que desce cai pela metade ou mais (228 KB → 93 KB
na Praça da Sé), e em rede móvel o tile é o que mais pesa numa tela de mapa.

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
      "id": "0b1f…",
      "name": "Pizzaria Calipso",
      "category": "pizza_restaurant",
      "latitude": -23.5351,
      "longitude": -46.4654,
      "street": "Av. Campanella, 610",
      "neighborhood": "Itaquera",
      "locality": "São Paulo",
      "region": "SP",
      "postcode": "08220-830"
    }
  ]
}
```

O `id` é o que o aplicativo manda numa sugestão sobre o lugar. O `Cache-Control` guarda uma
hora no aparelho e no CDN: uma sugestão aceita aparece no mapa em até uma hora.

Endereçada por tile, e não por raio, porque é assim que o aplicativo já pede o mapa — ele
tem cache por tile e descarta o que saiu da tela. Zoom aceito: **14 a 18** (abaixo disso um
tile cobre uma cidade inteira), com teto de 300 lugares por tile.

A rota existe porque o basemap não basta. Os POIs que vêm no tile da Protomaps saem do
OpenStreetMap, e a cobertura dele na periferia é escassa: num raio de 1 km em Itaquera, o
OSM tinha **um** estabelecimento, e o Overture tinha **229** no mesmo lugar.

O dado é do [Overture Maps](https://overturemaps.org/) sob **CDLA-Permissive 2.0** —
licença permissiva, uso comercial liberado e **sem obrigação de atribuição na tela**,
diferente do ODbL do basemap.

O Overture não sabe quem **fechou**: o status de funcionamento dele vem vazio, e 93% dos
lugares de São Paulo vêm de páginas do Facebook, que ficam no ar anos depois de o
restaurante fechar. Quem diz isso é o [Foursquare OS Places](https://opensource.foursquare.com/os-places/)
(Apache 2.0), cruzado na carga. Do Foursquare não se guarda nada — ele só decide quem sai.

Nada sai do mapa apagado: o lugar é **ocultado**, com o motivo em `hidden_reason`. A carga
oculta o que fechou, a duplicata (o mesmo negócio com duas páginas no Facebook, apontando
para o que ficou) e, numa carga do país inteiro, o que sumiu do release. O que ela ocultou e
volta a vir no dado volta ao mapa; o que uma pessoa decidiu (ver abaixo) ela não desfaz. As
regras e as medições estão comentadas em `infra/scripts/import-places.sh`.

O que conta como "lugar de comer" é a raiz `food_and_drink` da taxonomia do Overture, menos
doceria, lan house e sala VIP. O lugar que nenhuma fonte tem entra pela lista versionada
`infra/data/manual-places.json` (`npm run places:manual`).

### Sugestões e moderação

O usuário não escreve no mapa: ele **sugere**, e a sugestão só muda o mapa quando alguém a
aceita. São quatro tipos — `create` (um lugar novo), `update` (nome, categoria, endereço ou
posição), `close` (fechou) e `duplicate` (é o mesmo que outro).

| Feature        | Quem tem                        | O que permite                           |
| -------------- | ------------------------------- | --------------------------------------- |
| `create:place` | toda conta ativada              | sugerir um lugar novo                   |
| `update:place` | toda conta ativada              | sugerir correção, "fechou" ou duplicata |
| `admin`        | dada à mão                      | nada sozinha: marca quem modera         |
| `manage:place` | quem tem `admin`, por migration | aceitar e recusar sugestões             |

`admin` segue o repositório judhagsan: é um marcador, e cada ação exige a sua feature
granular. Para tornar alguém moderador, as duas vão juntas:
`user.addFeatures(id, ["admin", "manage:place"])`. A sugestão de quem tem `manage:place`
já entra aceita.

A correção aceita vai para as colunas do lugar **e** para `places.overrides`, que a carga
do Overture reaplica por cima do que ela trouxer — sem isso, o release seguinte desfaria a
correção.

### Cardápios

O aplicativo fotografa a folha, lê com um modelo de visão, a pessoa confere na tela de
revisão, e só então o cardápio sobe — **já estruturado**. Aqui não se lê foto nem se extrai
nada: confere-se a forma, e guarda-se.

```json
{
  "place_id": "<uuid do lugar>",
  "currency": "BRL",
  "sections": [
    {
      "title": "Pratos",
      "items": [
        {
          "name": "Virado à paulista",
          "ingredients": "arroz, tutu, bisteca",
          "price_cents": 4200
        }
      ]
    }
  ]
}
```

- **Só o nome do prato é obrigatório.** Preço e ingredientes faltam o tempo todo em cardápio
  de verdade, e o título da seção pode ser vazio.
- **Dinheiro é inteiro**, em centavos (`price_cents`). Número quebrado volta `400`: é o preço
  em reais mandado no lugar dos centavos.
- **O que vale é o mais recente**, e cada envio é um cardápio novo: os anteriores ficam
  guardados, como registro de quem mandou o quê. Mandar um cardápio para um lugar que já tem
  um, sem dizer qual ele substitui, responde `400`.
- **Três tabelas** (`menus`, `menu_sections`, `menu_items`), e não um documento: o produto é
  procurar prato e comparar preço entre lugares.

Mandar exige a feature `create:menu`, que toda conta ativada tem, e cada conta manda **no
máximo 10 cardápios por hora**. Ler é público, como o mapa.

`GET /api/v1/menus?place_id=` devolve o cardápio que vale, com o `id` de cada prato,
`place_location` (onde fica o lugar, de onde o aplicativo mede o raio de quem fotografa) e
`can_edit`: se a conta da sessão pode mudar o texto dele — só quem o mandou. Sem sessão, é
`false`. Quem mandou não sai na resposta.

#### Trocar o cardápio que vale

É o mesmo `POST`, dizendo em `replaces` qual cardápio ele substitui — o `id` que a leitura
devolveu. Sem trava nenhuma, um `POST` trocava o preço de qualquer lugar do mapa, e ninguém
revisa o que chega; por isso a troca tem dois caminhos:

- **Fotografando no lugar**: o pedido leva `position` (`latitude`, `longitude` e
  `accuracy_m`, o erro do GPS em metros), e quem está a **até 100 m** do ponto do lugar —
  descontado o erro, que conta a seu favor — troca o que quiser, de qualquer conta. Leitura
  com mais de 100 m de erro não conta: é a localização aproximada, e com ela qualquer um
  estaria no raio.
- **Sem fotografar**: só quem mandou o cardápio que vale, e só o texto. Cada prato volta com
  o `id` que tinha, todos voltam, e nenhum entra.

Fora disso, `403`, com a frase do que faltou. Se o cardápio de `replaces` já não é o que vale
— alguém trocou antes —, `409`, e nada é gravado. A troca fica em `audit_logs`
(`menu.replace`), e o cardápio novo guarda de qual saiu (`replaces_menu_id`) e a que
distância do lugar estava quem fotografou (`distance_m`) — a posição em si não é guardada.
É o que permite voltar atrás numa troca que não devia ter acontecido: a posição vem do
aparelho, e um GPS falso passa.

O primeiro cardápio de um lugar não pede posição.

`GET /api/v1/menus/places` lista os lugares que têm cardápio, com o resumo do que vale
(quantos pratos, de quando é) — é o que o botão "Cardápios" do aplicativo abre. Com `lat` e
`lon`, os mais próximos primeiro; sem eles, os mais recentes. São no máximo 50.

`GET /api/v1/user/menus` é a mesma lista, só com os lugares para onde a conta da sessão
mandou cardápio — a aba "Meus cardápios" do aplicativo. Do envio mais recente para o mais
antigo, um lugar por linha, e o resumo é o do último cardápio que **a conta** mandou para
ele, mesmo que outra pessoa o tenha trocado depois. Apagar a conta não apaga os cardápios
dela: eles continuam valendo para os lugares, na lista de todos.

E cada lugar do tile (`GET /api/v1/places/[z]/[x]/[y]`) traz `has_menu`: o aplicativo pinta
de verde o marcador de quem tem cardápio. O tile fica uma hora na borda, e por isso guardar
o primeiro cardápio de um lugar **apaga de lá os tiles dele**, de z14 a z18: a resposta do tile leva a
etiqueta dele no cabeçalho `Vercel-Cache-Tag`, e `menu.create` pede a purga por
`infra/cdn.js`. Sem isso o lugar aparecia na lista de cardápios, que não passa pela borda, e
seguia sem cor no mapa. Fora da Vercel não há borda, e a purga não faz nada.

### Ler a foto do cardápio

`POST /api/v1/vision/read` recebe a foto crua (`Content-Type: image/jpeg`, até 3 MB) e
devolve o cardápio estruturado — `{ model, menu }`, com `menu` no formato do schema de
`models/menuReading.js`. Quem fala com o provedor de visão (o Gemini) é o servidor, com a
chave de `GEMINI_API_KEY`, que **não sai daqui**. A foto não é guardada: existe só na
memória da função enquanto é lida.

- Exige **sessão de uma conta com `create:menu`**, a mesma feature de mandar o cardápio.
- **Sem limite de leituras por conta**, por decisão: a chave não sai do servidor, e o que
  segura o gasto é o **teto na conta do provedor**. Cada leitura fica em `audit_logs`
  (`vision.read`, com a conta e o IP), e o modelo, o tempo e os tokens vão para o log da
  função.
- A cadeia de modelos, do melhor ao último recurso, está em `infra/gemini.js`: a cota
  esgotada e a sobrecarga passam ao próximo; o crédito acabado, a chave errada e a foto
  recusada param na hora. A leitura inteira desiste em 270 s, abaixo dos 300 s da função.
- O status diz ao aplicativo o que dizer: `503` é "tente mais tarde" (sem crédito, sem cota
  em nenhum modelo, sem a chave no ambiente), `504` é "tente de novo" (sobrecarga, prazo),
  `422` é a foto que o provedor não leu, e `502` é a resposta que veio fora do formato.
- Não passa por `controller.shareDatabaseConnection`: a conexão ficaria presa ao pedido
  enquanto o provedor lê.

Até outubro de 2026 o aplicativo chamava o provedor direto, com a chave que
`GET /api/v1/vision/key` lhe entregava, trancada por um token que ia dentro do
aplicativo. A rota saiu quando o aplicativo passou a ler por aqui, e com ela a variável
`VISION_TOKEN`.

### Compartilhamento e site institucional

A página inicial (`pages/index.js`) traz a identidade visual de `lib/identidade.js`, o
logotipo oficial e os botões para instalação na App Store e no Google Play.

Os links compartilhados de cardápio apontam para `https://menuspoiler.com.br/cardapio/<place_id>`.
Quando o aplicativo está instalado, iOS e Android interceptam a rota pelo domínio associado;
no navegador, `pages/cardapio/[place_id].js` exibe apenas o nome do estabelecimento (sem
pratos nem preços) e os atalhos para abrir ou baixar o aplicativo.

### Suporte e ajuda

As solicitações de estabelecimentos ausentes e os pedidos de ajuda entram em
`support_requests` nas categorias `missing_place`, `account_help` e `general_help`:

- `GET /api/v1/support/info` devolve orientações de uso e o canal de contato configurado
  por `SUPPORT_CONTACT_EMAIL` / `SUPPORT_CONTACT_URL` (padrão `contato@menuspoiler.com.br`).
- `POST /api/v1/support/requests` aceita envios anônimos ou autenticados sob limite de
  **10 tentativas por IP a cada 15 minutos**, com coordenadas opcionais de referência.
  Solicitações não publicam estabelecimentos automaticamente no mapa.
- `GET /api/v1/support/requests` lista os chamados da sessão autenticada. Ao excluir a
  própria conta em `DELETE /api/v1/user`, `contact_name`, `contact_email` e
  `account_identifier` desses registros são anonimizados.

### Recuperação sem acesso ao e-mail antigo

Quem perdeu o acesso ao e-mail da conta consulta o questionário público em
`GET /api/v1/recoveries/without-email` e envia as respostas para
`POST /api/v1/recoveries/without-email` sob duas travas de rate limit (**5 por IP a cada
15 minutos** e **3 por identificador a cada 24 horas**). Campos contendo senha são
recusados e a resposta é uniforme (`202`) para evitar enumeração de contas.

- A aprovação automática só dispara confirmação no novo e-mail (`emailChange.requestChange`)
  para contas comuns e ativadas que tenham histórico privado (`menus` ou `place_suggestions`)
  e comprovem e-mail anterior, estabelecimento privado e sinal de reforço.
- Contas sem histórico, administrativas, inativas, respostas inconclusivas ou conflitos de
  e-mail encaminham um chamado deduplicado em `support_requests` (`account_help`) com
  resumo sanitizado, sem armazenar senhas nem respostas esperadas do banco.
- A confirmação em `/conta/confirmar-email/[token]` chama `PATCH /api/v1/email-changes/[token_id]`
  e oferece o envio do link de redefinição de senha (`POST /api/v1/recoveries` ou opção
  `send_password_recovery: true` no próprio `PATCH`).

### Painel administrativo (`/admin`)

A interface administrativa atende em `/admin` e exige conta ativada com as features de
operação do painel (`ALL_ADMIN_FEATURES` em `models/features.js`: `admin`, `manage:place`,
`manage:menu`, `manage:support`, `read:user:admin`, `update:user:others`, `erase:user:others`
e `manage:admins`). Contas comuns recebem bloqueio nas APIs e no login do painel.

- **Primeiro acesso em produção:** cadastre a conta pelo fluxo normal e promova com as
  variáveis `POSTGRES_*` de produção apontadas:

  ```bash
  npm run admin:promote -- seu-email@dominio.com
  ```

- **Desenvolvimento local:** `npm run admin:seed:dev` cria ou restaura a credencial local
  `admin@menuspoiler.local` / `devadminpassword` (bloqueada quando `NODE_ENV=production`).
- **Estabelecimentos e cardápios:** busque por nome, endereço ou UUID, filtre ocultos ou
  locais com cardápio e abra `/admin/estabelecimentos/[id]` para editar dados, coordenadas no
  mapa vetorial e itens do cardápio sem exigência de proximidade por GPS. Exclusões padrão
  ocultam o local (`hidden_reason` e `duplicate_of` opcional) preservando overrides para
  cargas futuras; remoção física só ocorre em locais criados no admin sem vínculos.
- **Sugestões, suporte e contas:** aprove ou recuse sugestões de locais, atenda chamados
  em `Solicitações e ajuda` (com pré-preenchimento direto ao cadastrar um local faltante e
  resumo da triagem de recuperação com atalho à conta) e gerencie usuários, cargos admin,
  trocas de nome/e-mail e auditoria em `/admin/usuarios/[id]`.

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

| Variável                | De onde vem                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `POSTGRES_HOST`         | Neon                                                         |
| `POSTGRES_PORT`         | Neon (`5432`)                                                |
| `POSTGRES_USER`         | Neon                                                         |
| `POSTGRES_PASSWORD`     | Neon                                                         |
| `POSTGRES_DB`           | Neon                                                         |
| `POSTGRES_CA`           | Opcional — certificado, se quiser fixar o SSL                |
| `EMAIL_SMTP_HOST`       | Provedor de e-mail transacional                              |
| `EMAIL_SMTP_PORT`       | Provedor de e-mail transacional                              |
| `EMAIL_SMTP_USER`       | Provedor de e-mail transacional                              |
| `EMAIL_SMTP_PASSWORD`   | Provedor de e-mail transacional                              |
| `PROTOMAPS_API_KEY`     | Protomaps — tiles do app e mapa vetorial do `/admin`         |
| `GEMINI_API_KEY`        | Provedor de visão — só o servidor a usa                      |
| `CRON_SECRET`           | Segredo para autenticar o cron diário `/api/v1/cron/cleanup` |
| `SUPPORT_CONTACT_EMAIL` | Opcional — sobrescreve `contato@menuspoiler.com.br`          |
| `SUPPORT_CONTACT_URL`   | Opcional — link secundário exibido em `/api/v1/support/info` |

Em produção a conexão com o Postgres usa SSL automaticamente; `POSTGRES_CA` só é
necessário se você quiser validar contra um certificado específico. Sem `PROTOMAPS_API_KEY`
no ambiente local, o mapa de `/admin` usa tiles vetoriais abertos do OpenFreeMap com as
mesmas camadas do aplicativo.

### 3. Migrations em produção

**Rodam sozinhas, a cada deploy.** A Vercel executa o script `vercel-build` no lugar do
`build` quando ele existe, e o nosso é:

```json
"vercel-build": "npm run migrations:up && next build"
```

`migrations:up` chama `infra/scripts/migrate.mjs`, que lê as `POSTGRES_*` do ambiente —
as mesmas variáveis que a aplicação usa, já configuradas na Vercel. Se a migration
falhar, o script sai com código 1 e **o deploy é abortado**: publicar código que espera
uma coluna inexistente é pior que não publicar.

O log do build mostra o host de destino **antes** de conectar. Vale conferir na primeira
vez: uma variável errada migraria o banco errado em silêncio, e um `undefined` ali diz na
hora que falta `POSTGRES_HOST` no ambiente.

**Só produção migra.** A Vercel roda o build em todo deploy, inclusive no preview de cada
PR, e o script lê `VERCEL_ENV` para pular os que não são de produção. São dois motivos: a
migration de um PR ainda não revisado não deve tocar em banco nenhum, e as `POSTGRES_*`
normalmente existem só no ambiente **Production** — sem elas o preview não tem onde
conectar e o build morreria com `ECONNREFUSED` em `127.0.0.1`.

Fora da Vercel a variável não existe, e aí nada é pulado: `npm run migrations:up` na sua
máquina migra o banco que as `POSTGRES_*` do seu ambiente apontarem.

A rota continua existindo para aplicar migrations sem um deploy novo — ela precisa de um
usuário com a feature `create:migration`:

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
HF_TOKEN=... npm run places:import
```

`NODE_ENV=production` liga o SSL exigido pela Neon.

`HF_TOKEN` é um token de **leitura** do Hugging Face, onde o Foursquare publica o dado:
crie a conta, aceite os termos em
[foursquare/fsq-os-places](https://huggingface.co/datasets/foursquare/fsq-os-places) e gere
o token em Settings → Access Tokens. Ele só é usado na hora da carga, por quem a roda — não
vai para a Vercel nem para o repositório. Sem ele a carga segue só com o Overture e avisa:
quem fechou continua no mapa.

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
Overture atualiza o que mudou, sem duplicar. O que ele apaga é só a lista de fechados do
Foursquare, por id; um lugar que simplesmente sai do Overture permanece na tabela até ser
removido à mão. Apagar "tudo o que não veio" seria mais simples, e uma carga de teste com
a caixa estreitada acima apagaria o resto do país.

Os releases são fixados no script (`OVERTURE_RELEASE`, `FSQ_RELEASE`), para que duas cargas feitas
em semanas diferentes carreguem o mesmo dado. Eles publicam um release por mês;
recarregar a cada poucos meses basta.

**Nada disso roda sozinho**: não há agendamento, pelo mesmo motivo que as migrations
também são disparadas à mão — automatizar exigiria dar credencial de escrita em massa no
banco de produção a um runner de CI, para um job que roda poucas vezes por ano.

### 5. Limpeza diária na Vercel

O `vercel.json` agenda `GET /api/v1/cron/cleanup` diariamente às `04:00` UTC para apagar
registros expirados de `rate_limits` (> 24 h) e sessões ou tokens vencidos (> 7 dias).
Configure `CRON_SECRET` na Vercel para autenticar a chamada via cabeçalho
`Authorization: Bearer <CRON_SECRET>`.

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
