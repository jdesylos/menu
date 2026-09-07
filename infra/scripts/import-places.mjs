// Carrega estabelecimentos do Overture Places no banco.
//
// # De onde vem o arquivo
//
// O Overture publica em GeoParquet no S3, e o jeito mais simples de recortar
// uma região é o CLI oficial (Python), que NÃO é dependência deste projeto —
// roda uma vez por release, na máquina de quem carrega:
//
//   pip install overturemaps
//   overturemaps download --bbox=-46.83,-24.01,-46.36,-23.35 \
//     -f geojsonseq --type=place -o sao-paulo.geojsonseq
//
// `geojsonseq` (uma feature por linha) e não `geojson`: o arquivo de uma
// cidade grande passa de um giga, e um JSON único obrigaria a carregá-lo
// inteiro na memória para ler a primeira linha.
//
// # Como rodar
//
//   node infra/scripts/import-places.mjs sao-paulo.geojsonseq
//
// As credenciais saem das mesmas variáveis de ambiente que a aplicação usa
// (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_DB,
// POSTGRES_PASSWORD). Apontando-as para o Neon, o mesmo comando carrega
// produção — ver o README.
//
// # Por que é idempotente
//
// O `ON CONFLICT` usa (source, source_id): rodar o import do release seguinte
// ATUALIZA o que mudou em vez de duplicar. Um lugar que sai do Overture
// permanece no banco até alguém removê-lo — some do dado, não da tabela.

// `.mjs` e não `.js`: o `package.json` não declara `type: module`, e um script
// com `import` num `.js` faz o Node reprocessar o arquivo e avisar. A extensão
// resolve sem mexer no resto do projeto, que é CommonJS fora do Next.
//
// O Node ainda avisa uma vez sobre o `infra/database.js`, que é ESM dentro do
// mesmo pacote sem `type`. É ruído, não erro: o import funciona, e o preço é
// um reparse de um arquivo pequeno num script que roda algumas vezes por ano.
import fs from "node:fs";
import readline from "node:readline";
import database from "../database.js";

// O que conta como "onde se come".
//
// A taxonomia do Overture tem centenas de categorias, quase todas compostas
// (`pizza_restaurant`, `japanese_restaurant`, `coffee_shop`). Casar por pedaço
// do nome cobre o conjunto inteiro sem enumerar uma lista que envelheceria a
// cada release deles.
// Categorias que casariam por acidente e não são lugar de comer. "bar" pega
// tabacaria e casa de narguilé; o ícone do aplicativo é garfo e faca, e ele
// mentiria sobre elas.
const NOT_FOOD_CATEGORIES = ["hookah", "shisha", "tobacco", "smoke_shop"];

const FOOD_CATEGORY_PARTS = [
  "restaurant",
  "food",
  "bar",
  "pub",
  "cafe",
  "coffee",
  "pizza",
  "bakery",
  "steak",
  "diner",
  "brewery",
  "ice_cream",
  "dessert",
  "snack",
  "juice",
];

// Quantas linhas por INSERT. Quinhentas mantêm a consulta abaixo do limite de
// parâmetros do Postgres com folga, e ainda assim fazem uma cidade inteira
// entrar em poucos minutos.
const BATCH_SIZE = 500;

const SOURCE = "overture";

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error(
      "uso: node infra/scripts/import-places.mjs <arquivo.geojsonseq>",
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

  try {
    for await (const line of stream) {
      if (!line.trim()) continue;

      const place = parseFeature(line);
      if (!place) {
        skipped++;
        continue;
      }

      batch.push(place);

      if (batch.length >= BATCH_SIZE) {
        await upsert(client, batch);
        imported += batch.length;
        batch = [];
        process.stdout.write(`\r${imported} estabelecimentos...`);
      }
    }

    if (batch.length > 0) {
      await upsert(client, batch);
      imported += batch.length;
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n${imported} estabelecimentos carregados, ${skipped} ignorados`,
  );
}

// Uma linha do arquivo vira um lugar — ou `null`, quando não é comida, não tem
// nome ou não tem ponto.
//
// Sem nome não entra: o mapa desenha o nome ao lado do ícone, e um marcador
// anônimo ocupa o lugar de um que diz alguma coisa.
function parseFeature(line) {
  let feature;
  try {
    feature = JSON.parse(line);
  } catch {
    return null;
  }

  const properties = feature?.properties;
  const coordinates = feature?.geometry?.coordinates;

  if (!properties || !Array.isArray(coordinates)) {
    return null;
  }

  const name = properties.names?.primary;
  const category = properties.categories?.primary;
  const sourceId = properties.id;

  if (!name || !sourceId || !isFood(category)) {
    return null;
  }

  const [longitude, latitude] = coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { sourceId, name, category, latitude, longitude };
}

function isFood(category) {
  if (typeof category !== "string") {
    return false;
  }

  if (NOT_FOOD_CATEGORIES.some((part) => category.includes(part))) {
    return false;
  }

  return FOOD_CATEGORY_PARTS.some((part) => category.includes(part));
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
