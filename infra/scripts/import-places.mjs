// Carrega no banco o CSV de estabelecimentos que o `import-places.sh` extraiu.
//
// # O que ele NÃO faz
//
// Não filtra nada. O que decide o que é lugar de comer é a consulta do
// `import-places.sh`, e é lá que a lista de categorias vive — uma segunda cópia
// dela aqui divergiria da primeira no dia em que alguém corrigisse só uma. O
// mesmo vale para quem fechou e para quem é duplicata: o shell decide, e este
// script aplica.
//
// Este script existe separado por dois motivos: dá para recarregar um CSV já
// extraído sem falar com o S3 de novo, e o acesso ao Postgres continua onde já
// estava, no `pg` que o projeto usa em todo o resto.
//
// # Uso
//
//   node infra/scripts/import-places.mjs <lugares.csv>
//     [--fechados=<fechados.csv>] [--duplicados=<duplicados.csv>]
//     [--pais-inteiro]
//
// Normalmente quem chama é o `import-places.sh`, que extrai e carrega numa
// tacada. As credenciais saem das mesmas variáveis de ambiente da aplicação.
//
// # Por que é idempotente
//
// O `ON CONFLICT` usa (source, source_id): rodar o import do release seguinte
// ATUALIZA o que mudou em vez de duplicar.
//
// # O que ele tira do mapa
//
// Nada é apagado: o lugar é OCULTADO, com o motivo — ver a migration
// "ocultar-places-em-vez-de-apagar". Três motivos, nesta ordem:
//
// - `closed`: os ids de `--fechados`, que o Foursquare dá como fechados;
// - `duplicate`: os ids de `--duplicados`, cada um apontando para o lugar que
//   ficou no lugar dele;
// - `missing_from_source`: o que já estava no banco e não veio no CSV. Só com
//   `--pais-inteiro`, que o shell passa quando a carga cobre o Brasil todo:
//   numa carga de teste com uma caixa estreita (`OESTE=... npm run
//   places:import`) o resto do país "não veio", e sumiria do mapa.
//
// O que a carga ocultou e volta a vir no dado volta ao mapa — ver
// `places-upsert.mjs`.
//
// `.mjs` e não `.js`: o `package.json` não declara `type: module`, e um script
// com `import` num `.js` faz o Node reprocessar o arquivo e avisar.

import fs from "node:fs";
import readline from "node:readline";
import database from "../database.js";
import { upsertPlaces } from "./places-upsert.mjs";

// Quantas linhas por INSERT. Quinhentas mantêm a consulta abaixo do limite de
// parâmetros do Postgres com folga, e ainda assim fazem o país inteiro entrar
// em poucos minutos.
const BATCH_SIZE = 500;

// Quantos ids por UPDATE de ocultar. Vão em parâmetros de array, então o
// limite de parâmetros não pesa; o teto só evita uma consulta de megabytes.
const HIDE_BATCH_SIZE = 1000;

// Quanto uma carga pode tirar do mapa por "sumiu da fonte" antes de parar e
// pedir que alguém olhe.
//
// Medido de agosto para setembro de 2026, na cidade de São Paulo: sumiram do
// Overture 1,2% dos lugares de comer. Cinco por cento dá folga para um mês
// ruim e ainda pega o que não é mês ruim — um CSV que veio cortado pela
// metade ocultaria metade do país. O piso absoluto existe para o banco
// pequeno, local ou de teste, onde um lugar só já passa de cinco por cento.
const MAX_MISSING_SHARE = 0.05;
const MAX_MISSING_FLOOR = 1000;

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
  const args = parseArgs(process.argv.slice(2));

  if (!args.places) {
    console.error(
      "uso: node infra/scripts/import-places.mjs <lugares.csv> " +
        "[--fechados=<arquivo>] [--duplicados=<arquivo>] [--pais-inteiro]",
    );
    process.exit(1);
  }

  const client = await database.getNewClient();

  try {
    // O instante em que a carga começou, na mesma régua do `updated_at` que o
    // upsert grava. Quem ficar com `updated_at` anterior a ele não veio no CSV.
    const started = await client.query(
      "SELECT (timezone('utc', now()))::timestamptz::text AS started_at;",
    );
    const startedAt = started.rows[0].started_at;

    await loadPlaces(client, args.places);

    if (args.closed) {
      const ids = readIds(args.closed, ["source_id"]).map(([id]) => id);
      const hidden = await hideClosed(client, ids);
      console.log(`      ${hidden} fechados ocultados`);
    }

    if (args.duplicates) {
      const pairs = readIds(args.duplicates, ["source_id", "duplicate_of"]);
      const hidden = await hideDuplicates(client, pairs);
      console.log(`      ${hidden} duplicatas ocultadas`);
    }

    if (args.wholeCountry) {
      const hidden = await hideMissing(client, startedAt);
      console.log(`      ${hidden} que sumiram do Overture ocultados`);
    }
  } finally {
    await client.end();
  }
}

function parseArgs(argv) {
  const args = { places: null, closed: null, duplicates: null };

  for (const arg of argv) {
    if (arg === "--pais-inteiro") {
      args.wholeCountry = true;
    } else if (arg.startsWith("--fechados=")) {
      args.closed = arg.slice("--fechados=".length);
    } else if (arg.startsWith("--duplicados=")) {
      args.duplicates = arg.slice("--duplicados=".length);
    } else if (!arg.startsWith("--") && !args.places) {
      args.places = arg;
    } else {
      console.error(`erro: argumento desconhecido: ${arg}`);
      process.exit(1);
    }
  }

  return args;
}

async function loadPlaces(client, filePath) {
  const stream = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let batch = [];
  let imported = 0;
  let skipped = 0;
  let header = null;

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
      await upsertPlaces(client, SOURCE, batch);
      imported += batch.length;
      batch = [];
      process.stdout.write(`\r      ${imported} carregados...`);
    }
  }

  if (batch.length > 0) {
    await upsertPlaces(client, SOURCE, batch);
    imported += batch.length;
  }

  console.log(`\r      ${imported} carregados, ${skipped} ignorados`);
}

// Lê um arquivo auxiliar de ids — fechados ou duplicados — inteiro.
//
// INTEIRO, e não linha a linha com `readline` como o CSV principal. A primeira
// versão iterava com `for await` e esperava o banco dentro do laço, e em
// produção morreu com `ERR_USE_AFTER_CLOSE`: o iterador do `readline` guarda
// até 1024 linhas e PAUSA a leitura quando o consumidor atrasa; se o arquivo
// acaba durante a pausa, a interface fecha, e o `resume()` seguinte lança. Com
// a Neon cada consulta custa uma ida e volta de rede e a pausa acontece; com o
// Postgres local ela volta em microssegundos e o teste passou. São dezenas de
// milhares de ids, alguns megabytes: ler tudo de uma vez não custa nada e tira
// o problema do caminho.
function readIds(filePath, expectedHeader) {
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  const header = parseLine(lines[0] ?? "");
  const same =
    header.length === expectedHeader.length &&
    expectedHeader.every((column, i) => header[i] === column);

  if (!same) {
    console.error(
      `erro: cabeçalho inesperado em ${filePath}: ${header.join(",")}`,
    );
    process.exit(1);
  }

  return lines.slice(1).map(parseLine);
}

// Oculta os fechados, em lotes.
//
// Conta o que de fato saiu do mapa, e não o tamanho da lista: o fechado do mês
// passado já está oculto e não conta de novo — e é essa diferença que diz se a
// regra está tirando demais.
async function hideClosed(client, sourceIds) {
  let hidden = 0;

  for (let i = 0; i < sourceIds.length; i += HIDE_BATCH_SIZE) {
    const result = await client.query({
      text: `
        UPDATE
          places
        SET
          hidden_at = timezone('utc', now()),
          hidden_reason = 'closed'
        WHERE
          source = $1
          AND source_id = ANY($2::text[])
          AND hidden_at IS NULL
      ;`,
      values: [SOURCE, sourceIds.slice(i, i + HIDE_BATCH_SIZE)],
    });
    hidden += result.rowCount;
  }

  return hidden;
}

// Oculta as duplicatas, cada uma apontando para o lugar que ficou.
//
// Só mexe na duplicata que está visível ou que apontava para outro lugar: a
// que já estava oculta apontando para o mesmo não conta, pelo mesmo motivo do
// `hideClosed`.
async function hideDuplicates(client, pairs) {
  let hidden = 0;

  for (let i = 0; i < pairs.length; i += HIDE_BATCH_SIZE) {
    const batch = pairs.slice(i, i + HIDE_BATCH_SIZE);
    const result = await client.query({
      text: `
        UPDATE
          places AS duplicate
        SET
          hidden_at = timezone('utc', now()),
          hidden_reason = 'duplicate',
          duplicate_of = kept.id
        FROM
          unnest($2::text[], $3::text[]) AS pair(duplicate_id, kept_id)
          JOIN places AS kept
            ON kept.source = $1 AND kept.source_id = pair.kept_id
        WHERE
          duplicate.source = $1
          AND duplicate.source_id = pair.duplicate_id
          AND (
            duplicate.hidden_at IS NULL
            OR (
              duplicate.hidden_reason = 'duplicate'
              AND duplicate.duplicate_of IS DISTINCT FROM kept.id
            )
          )
      ;`,
      values: [
        SOURCE,
        batch.map(([duplicateId]) => duplicateId),
        batch.map(([, keptId]) => keptId),
      ],
    });
    hidden += result.rowCount;
  }

  return hidden;
}

// Oculta o que sumiu do Overture: o lugar visível que esta carga não tocou.
//
// Confere o tamanho ANTES — ver `MAX_MISSING_SHARE`. Passando do limite, não
// oculta nada e sai com erro: o que foi carregado fica, e quem roda decide se
// o release mudou mesmo tanto assim.
async function hideMissing(client, startedAt) {
  const counts = await client.query({
    text: `
      SELECT
        count(*) FILTER (WHERE updated_at < $2::timestamptz)::int AS missing,
        count(*)::int AS visible
      FROM
        places
      WHERE
        source = $1
        AND hidden_at IS NULL
    ;`,
    values: [SOURCE, startedAt],
  });
  const { missing, visible } = counts.rows[0];

  if (missing > Math.max(MAX_MISSING_FLOOR, visible * MAX_MISSING_SHARE)) {
    console.error(
      `erro: ${missing} de ${visible} lugares visíveis sumiriam do mapa, mais ` +
        `que o limite de ${MAX_MISSING_SHARE * 100}%. Nada foi ocultado por ` +
        `sumir do Overture. Confira se o CSV veio inteiro antes de mexer no ` +
        `limite (MAX_MISSING_SHARE, em import-places.mjs).`,
    );
    process.exit(1);
  }

  const result = await client.query({
    text: `
      UPDATE
        places
      SET
        hidden_at = timezone('utc', now()),
        hidden_reason = 'missing_from_source'
      WHERE
        source = $1
        AND hidden_at IS NULL
        AND updated_at < $2::timestamptz
    ;`,
    values: [SOURCE, startedAt],
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

main();
