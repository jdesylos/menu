// Aplica as migrations pendentes usando as variáveis de ambiente.
//
// # Por que existe, se já há `migrations:up:dev` e a rota `/api/v1/migrations`
//
// Nenhum dos dois serve ao DEPLOY. O `migrations:up:dev` está preso ao
// `--envPath .env.development`, que aponta para o Postgres do `compose.yaml`:
// chamado no build da Vercel, ele tentaria conectar na máquina de build. E a
// rota exige alguém logado chamando à mão depois que o deploy terminou — até
// lá, o código novo já está no ar conversando com um banco velho.
//
// Este script lê as `POSTGRES_*` do ambiente, que é o que a Vercel fornece, e
// é o que o `vercel-build` chama antes do `next build`.
//
// # O SSL
//
// Vem de `infra/database.js`, junto do resto da conexão. Repetir a regra aqui
// criaria uma segunda: no dia em que o certificado da Neon mudasse, alguém
// consertaria uma das duas.
//
// `.mjs` porque o `package.json` não declara `type: module` — a mesma razão do
// `import-places.mjs`.

import { resolve } from "node:path";

import migrationRunner from "node-pg-migrate";

import database from "../database.js";

async function main() {
  if (shouldSkip()) {
    return;
  }

  // O host ANTES de conectar, não depois: numa falha de conexão o `console.log`
  // lá embaixo nunca chegaria a rodar, e era justamente o caso em que saber o
  // destino importa. `undefined` aqui já diz que falta `POSTGRES_HOST` no
  // ambiente — que é como o `pg` acaba tentando o localhost.
  console.log(`🔷 Migrando ${process.env.POSTGRES_HOST}...`);

  const client = await database.getNewClient();

  try {
    const migrated = await migrationRunner({
      dbClient: client,
      dir: resolve("infra", "migrations"),
      direction: "up",
      migrationsTable: "pgmigrations",
      dryRun: false,
      log: () => {},
    });

    if (migrated.length === 0) {
      console.log("🟢 Nenhuma migração pendente.");
      return;
    }

    console.log(`🟢 ${migrated.length} migração(ões) executada(s):`);
    migrated.forEach((migration) => console.log(`   - ${migration.name}`));
  } finally {
    await client.end();
  }
}

// Só produção migra.
//
// A Vercel roda o build em TODO deploy, inclusive no preview de cada PR, e
// `VERCEL_ENV` é o que diz qual é qual. Migrar no preview tem dois problemas: a
// migration de um PR que ainda não foi revisado seria aplicada ao banco que
// aquele ambiente apontar, e — quando as variáveis do banco existem só para
// Production, que é o arranjo normal — o preview não tem onde conectar e o
// build morre com `ECONNREFUSED` em `127.0.0.1`.
//
// Fora da Vercel a variável não existe, e aí não se pula nada: é o caminho de
// quem roda `npm run migrations:up` na própria máquina, apontando para onde
// quiser.
function shouldSkip() {
  const environment = process.env.VERCEL_ENV;

  if (!environment || environment === "production") {
    return false;
  }

  console.log(`🔵 Deploy de ${environment}: migrações puladas.`);
  return true;
}

// `exit(1)` derruba o build de propósito. Publicar código que espera uma
// coluna que não existe é pior que não publicar: o deploy passa, e o erro
// aparece na cara do usuário na primeira requisição.
main().catch((error) => {
  console.error("🔴 Falha ao executar as migrações:", error);
  process.exit(1);
});
