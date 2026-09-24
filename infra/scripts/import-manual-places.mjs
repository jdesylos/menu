// Carrega no banco os lugares acrescentados à mão: os que existem e que
// nenhuma fonte tem.
//
// # Por que existe
//
// O Overture é a fonte do mapa, e ele atrasa: o Restaurante Tia Lourdes, no
// Butantã, abriu em agosto de 2025 e não estava nem no release de setembro de
// 2026. Esperar a fonte deixaria o lugar fora do mapa por tempo
// indeterminado; e inseri-lo direto no banco não deixaria rastro de por que ele
// está lá, nem de quem conferiu.
//
// A lista mora em `infra/data/manual-places.json`, versionada. Cada entrada
// leva uma `fonte` obrigatória — de onde se sabe que o lugar existe — que não
// vai para o banco: o histórico do git é o lugar dela.
//
// # O que ele tira do mapa
//
// Os lugares `manual` que SAÍRAM do arquivo — ocultados, e não apagados, como
// na carga do Overture (ver a migration "ocultar-places-em-vez-de-apagar").
// Aqui não é preciso cuidado com recorte: o arquivo é sempre a lista inteira,
// e não um pedaço do país. Tirar uma entrada do arquivo e rodar isto tira o
// lugar do mapa; devolvê-la ao arquivo o traz de volta.
//
// Os lugares do Overture não são tocados: tudo aqui filtra por `source`.
//
// # Uso
//
//   node infra/scripts/import-manual-places.mjs [arquivo.json]
//
// Sem argumento, usa a lista versionada. O `import-places.sh` chama isto ao
// fim de toda carga; `npm run places:manual` aplica a lista sozinha, sem
// esperar os minutos de S3 da carga inteira. As credenciais saem das mesmas
// variáveis de ambiente da aplicação.

import fs from "node:fs";
import database from "../database.js";
import { upsertPlaces } from "./places-upsert.mjs";

const SOURCE = "manual";

const DEFAULT_PATH = new URL("../data/manual-places.json", import.meta.url);

// A caixa do Brasil, a mesma do `import-places.sh`. Não é enfeite: trocar
// latitude com longitude põe o lugar no oceano Índico, sem erro nenhum.
const BRAZIL = { west: -75, south: -35, east: -32, north: 6 };

// O id vira o `source_id`, e é o que faz a entrada ser atualizada em vez de
// duplicada quando o nome ou o ponto mudam. Minúsculas, números e hífen: ele
// aparece em diff e em log, e precisa ser lido por gente.
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const OPTIONAL_TEXT = [
  "category",
  "street",
  "neighborhood",
  "locality",
  "region",
  "postcode",
];

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_PATH;
  const places = readPlaces(filePath);

  const client = await database.getNewClient();

  try {
    await client.query("BEGIN");

    if (places.length > 0) {
      await upsertPlaces(client, SOURCE, places);
    }
    const hidden = await hideMissing(
      client,
      places.map((place) => place.sourceId),
    );

    await client.query("COMMIT");
    console.log(
      `      ${places.length} lugares manuais carregados, ${hidden} ocultados`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

// Lê e confere o arquivo INTEIRO antes de tocar no banco.
//
// Uma entrada errada derruba a carga toda, e não só ela: pular a entrada torta
// e seguir faria o `hideMissing` tirar do mapa um lugar que continua no
// arquivo.
function readPlaces(filePath) {
  const entries = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(entries)) {
    fail([`${filePath}: esperava uma lista de lugares`]);
  }

  const errors = [];
  const seen = new Set();

  const places = entries.map((entry, index) => {
    const where = `entrada ${index + 1} (${entry?.id ?? "sem id"})`;

    if (typeof entry?.id !== "string" || !ID_PATTERN.test(entry.id)) {
      errors.push(`${where}: "id" precisa ser minúsculas, números e hífen`);
    } else if (seen.has(entry.id)) {
      errors.push(`${where}: "id" repetido`);
    } else {
      seen.add(entry.id);
    }

    if (!isText(entry?.name)) {
      errors.push(`${where}: falta "name"`);
    }
    if (!isText(entry?.fonte)) {
      errors.push(`${where}: falta "fonte" — de onde se sabe que ele existe`);
    }
    if (!inBrazil(entry?.latitude, entry?.longitude)) {
      errors.push(`${where}: "latitude"/"longitude" fora do Brasil`);
    }
    for (const field of OPTIONAL_TEXT) {
      if (entry?.[field] != null && !isText(entry[field])) {
        errors.push(`${where}: "${field}" precisa ser texto ou null`);
      }
    }

    // NFC como no resto do dado: o nome digitado num editor que decompõe
    // acento seria outro nome para a busca.
    return {
      sourceId: entry?.id,
      name: normalize(entry?.name),
      category: normalize(entry?.category),
      latitude: entry?.latitude,
      longitude: entry?.longitude,
      neighborhood: normalize(entry?.neighborhood),
      street: normalize(entry?.street),
      postcode: normalize(entry?.postcode),
      locality: normalize(entry?.locality),
      region: normalize(entry?.region),
    };
  });

  if (errors.length > 0) {
    fail(errors);
  }

  return places;
}

async function hideMissing(client, sourceIds) {
  const result = await client.query({
    text: `
      UPDATE
        places
      SET
        hidden_at = timezone('utc', now()),
        hidden_reason = 'missing_from_source'
      WHERE
        source = $1
        AND NOT (source_id = ANY($2::text[]))
        AND hidden_at IS NULL
    ;`,
    values: [SOURCE, sourceIds],
  });

  return result.rowCount;
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function inBrazil(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= BRAZIL.south &&
    latitude <= BRAZIL.north &&
    longitude >= BRAZIL.west &&
    longitude <= BRAZIL.east
  );
}

function normalize(value) {
  return isText(value) ? value.trim().normalize("NFC") : null;
}

function fail(errors) {
  console.error("erro: lista de lugares manuais inválida");
  for (const error of errors) {
    console.error(`  ${error}`);
  }
  process.exit(1);
}

main();
