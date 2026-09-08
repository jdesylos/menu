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
  const client = await database.getNewClient();

  try {
    // O host no log é de propósito: é a única forma de ver, no log do build,
    // contra QUAL banco a migration rodou. Sem isso, uma variável de ambiente
    // errada migra o banco errado em silêncio.
    console.log(`🔷 Migrando ${process.env.POSTGRES_HOST}...`);

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

// `exit(1)` derruba o build de propósito. Publicar código que espera uma
// coluna que não existe é pior que não publicar: o deploy passa, e o erro
// aparece na cara do usuário na primeira requisição.
main().catch((error) => {
  console.error("🔴 Falha ao executar as migrações:", error);
  process.exit(1);
});
