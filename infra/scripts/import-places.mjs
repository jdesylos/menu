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
//   node infra/scripts/import-places.mjs <arquivo.csv> [fechados.csv]
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
// # O que ele apaga
//
// Só os ids do segundo arquivo: os lugares que o Foursquare dá como fechados —
// ver `import-places.sh`. Uma lista explícita, e não "tudo o que não veio no
// CSV": uma carga de teste com uma caixa estreita (`OESTE=... npm run
// places:import`) apagaria o resto do país.
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

// Quantos ids por DELETE. Vão num único parâmetro de array, então o limite de
// parâmetros não pesa; o teto só evita uma consulta de megabytes.
const DELETE_BATCH_SIZE = 1000;

const SOURCE = "overture";

// A ordem das colunas que o `import-places.sh` escreve. Conferida contra o
// cabeçalho do arquivo antes de ler qualquer linha: um CSV com outra ordem
// carregaria latitude no lugar do nome, sem erro nenhum.
const COLUMNS = [
  "source_id",
  "name",
  "category",
  "latitude",
  "longitude",
  "neighborhood",
  "street",
  "postcode",
  "locality",
  "region",
];

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error(
      "uso: node infra/scripts/import-places.mjs <arquivo.csv> [fechados.csv]",
    );
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

    console.log(`\r      ${imported} carregados, ${skipped} ignorados`);

    const closedPath = process.argv[3];
    if (closedPath) {
      const removed = await removeClosed(client, closedPath);
      console.log(`      ${removed} fechados removidos do banco`);
    }
  } finally {
    await client.end();
  }
}

// Apaga os lugares fechados, em lotes.
//
// Conta o que de fato saiu, e não o tamanho da lista: na primeira carga com o
// Foursquare saem os que já estavam no banco, nas seguintes quase nada — e é
// essa diferença que diz se a regra está tirando demais.
async function removeClosed(client, filePath) {
  const stream = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let header = null;
  let batch = [];
  let removed = 0;

  for await (const line of stream) {
    if (!line.trim()) continue;

    if (header === null) {
      header = parseLine(line);
      if (header.length !== 1 || header[0] !== "source_id") {
        console.error(
          `erro: cabeçalho inesperado em ${filePath}: ${header.join(",")}`,
        );
        process.exit(1);
      }
      continue;
    }

    batch.push(parseLine(line)[0]);

    if (batch.length >= DELETE_BATCH_SIZE) {
      removed += await deleteBatch(client, batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    removed += await deleteBatch(client, batch);
  }

  return removed;
}

async function deleteBatch(client, sourceIds) {
  const result = await client.query({
    text: `
      DELETE FROM
        places
      WHERE
        source = $1
        AND source_id = ANY($2::text[])
    ;`,
    values: [SOURCE, sourceIds],
  });

  return result.rowCount;
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

  const [
    sourceId,
    name,
    category,
    rawLatitude,
    rawLongitude,
    neighborhood,
    street,
    postcode,
    locality,
    region,
  ] = fields;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);

  if (!sourceId || !name) {
    return null;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  // Campo de endereço vazio vira nulo, e não string vazia: os dois viram a
  // mesma coisa na tela, mas só o nulo diz "o Overture não sabe" quando alguém
  // for medir a cobertura do dado.
  return {
    sourceId,
    name,
    category: category || null,
    latitude,
    longitude,
    neighborhood: neighborhood || null,
    street: street || null,
    postcode: postcode || null,
    locality: locality || null,
    region: region || null,
  };
}

// Quantos parâmetros cada linha ocupa no INSERT — a fonte mais as colunas do
// CSV. Contar aqui em vez de escrever o número faz a conta acompanhar a lista
// quando ela crescer de novo.
const PARAMS_PER_ROW = 1 + COLUMNS.length;

async function upsert(client, places) {
  const values = [];
  const rows = places.map((place, index) => {
    const offset = index * PARAMS_PER_ROW;
    values.push(
      SOURCE,
      place.sourceId,
      place.name,
      place.category,
      place.latitude,
      place.longitude,
      place.neighborhood,
      place.street,
      place.postcode,
      place.locality,
      place.region,
    );

    const params = Array.from(
      { length: PARAMS_PER_ROW },
      (_, i) => `$${offset + i + 1}`,
    );

    return `(${params.join(", ")})`;
  });

  await client.query({
    text: `
      INSERT INTO
        places (
          source, source_id, name, category, latitude, longitude,
          neighborhood, street, postcode, locality, region
        )
      VALUES
        ${rows.join(", ")}
      ON CONFLICT
        (source, source_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        neighborhood = EXCLUDED.neighborhood,
        street = EXCLUDED.street,
        postcode = EXCLUDED.postcode,
        locality = EXCLUDED.locality,
        region = EXCLUDED.region,
        updated_at = timezone('utc', now())
    ;`,
    values,
  });
}

main();
