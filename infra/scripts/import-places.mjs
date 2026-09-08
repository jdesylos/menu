// Carrega no banco o CSV de estabelecimentos que o `import-places.sh` extraiu.
//
// # O que ele NÃO faz
//
// Não filtra nada. O que decide o que é lugar de comer é a consulta do
// `import-places.sh`, e é lá que a lista de categorias vive — uma segunda cópia
// dela aqui divergiria da primeira no dia em que alguém corrigisse só uma.
//
// Este script existe separado por dois motivos: dá para recarregar um CSV já
// extraído sem falar com o S3 de novo, e o acesso ao Postgres continua onde já
// estava, no `pg` que o projeto usa em todo o resto.
//
// # Uso
//
//   node infra/scripts/import-places.mjs <arquivo.csv>
//
// Normalmente quem chama é o `import-places.sh`, que extrai e carrega numa
// tacada. As credenciais saem das mesmas variáveis de ambiente da aplicação.
//
// # Por que é idempotente
//
// O `ON CONFLICT` usa (source, source_id): rodar o import do release seguinte
// ATUALIZA o que mudou em vez de duplicar. Um lugar que sai do Overture
// permanece no banco até alguém removê-lo — some do dado, não da tabela.
//
// `.mjs` e não `.js`: o `package.json` não declara `type: module`, e um script
// com `import` num `.js` faz o Node reprocessar o arquivo e avisar.

import fs from "node:fs";
import readline from "node:readline";
import database from "../database.js";

// Quantas linhas por INSERT. Quinhentas mantêm a consulta abaixo do limite de
// parâmetros do Postgres com folga, e ainda assim fazem o país inteiro entrar
// em poucos minutos.
const BATCH_SIZE = 500;

const SOURCE = "overture";

// A ordem das colunas que o `import-places.sh` escreve. Conferida contra o
// cabeçalho do arquivo antes de ler qualquer linha: um CSV com outra ordem
// carregaria latitude no lugar do nome, sem erro nenhum.
const COLUMNS = ["source_id", "name", "category", "latitude", "longitude"];

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("uso: node infra/scripts/import-places.mjs <arquivo.csv>");
    process.exit(1);
  }

  const client = await database.getNewClient();
  const stream = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let batch = [];
  let imported = 0;
  let skipped = 0;
  let header = null;

  try {
    for await (const line of stream) {
      if (!line.trim()) continue;

      if (header === null) {
        header = parseLine(line);
        assertHeader(header);
        continue;
      }

      const place = parseRow(parseLine(line));
      if (!place) {
        skipped++;
        continue;
      }

      batch.push(place);

      if (batch.length >= BATCH_SIZE) {
        await upsert(client, batch);
        imported += batch.length;
        batch = [];
        process.stdout.write(`\r      ${imported} carregados...`);
      }
    }

    if (batch.length > 0) {
      await upsert(client, batch);
      imported += batch.length;
    }
  } finally {
    await client.end();
  }

  console.log(`\r      ${imported} carregados, ${skipped} ignorados`);
}

function assertHeader(header) {
  const igual =
    header.length === COLUMNS.length &&
    COLUMNS.every((coluna, i) => header[i] === coluna);

  if (!igual) {
    console.error(
      `erro: cabeçalho inesperado.\n  esperado: ${COLUMNS.join(",")}\n  veio:     ${header.join(",")}`,
    );
    process.exit(1);
  }
}

// CSV do DuckDB: aspas duplas quando o campo tem vírgula ou aspas, e aspas
// dobradas por escape. Uma dependência de parser resolveria o caso geral, mas
// este arquivo é gerado por nós, com formato conhecido — e o projeto não ganha
// uma dependência por causa de um script.
function parseLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

function parseRow(fields) {
  if (fields.length !== COLUMNS.length) {
    return null;
  }

  const [sourceId, name, category, rawLatitude, rawLongitude] = fields;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);

  if (!sourceId || !name) {
    return null;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { sourceId, name, category: category || null, latitude, longitude };
}

async function upsert(client, places) {
  const values = [];
  const rows = places.map((place, index) => {
    const offset = index * 6;
    values.push(
      SOURCE,
      place.sourceId,
      place.name,
      place.category,
      place.latitude,
      place.longitude,
    );

    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
  });

  await client.query({
    text: `
      INSERT INTO
        places (source, source_id, name, category, latitude, longitude)
      VALUES
        ${rows.join(", ")}
      ON CONFLICT
        (source, source_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        updated_at = timezone('utc', now())
    ;`,
    values,
  });
}

main();
