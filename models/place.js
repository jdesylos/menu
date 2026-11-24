import crypto from "node:crypto";
import database from "infra/database.js";
import cdn from "infra/cdn.js";
import tile from "models/tile.js";
import { ConflictError, NotFoundError, ValidationError } from "infra/errors.js";

// Abaixo de 14 um tile cobre uma cidade inteira, e a resposta seria de
// milhares de lugares que o aplicativo não teria como desenhar sem virar uma
// mancha. Quem quer visão de cidade não quer a lista de bares dela.
const MIN_ZOOM = 14;

// Acima de 18 o tile cobre menos que um quarteirão: pedir nessa escala só
// multiplicaria requisições para devolver os mesmos poucos lugares.
const MAX_ZOOM = 18;

// Teto por tile. Num tile de zoom 14 no centro de São Paulo cabem centenas de
// estabelecimentos; o aplicativo desenha algumas dezenas, e trazer o resto
// gastaria banda de rede para nada.
//
// O teto MORDE: medido no release 2026-08-19.0 do Overture, o tile de z14 da
// Liberdade tem 1709 lugares e o de z15, 366. Por isso o aplicativo pede em
// z16, onde o tile mais cheio da cidade de São Paulo tem 272. Quando o teto
// morder mesmo assim, quem fica de fora é decidido pela ordem em
// `findWithinTile`.
const MAX_PLACES_PER_TILE = 300;

function parseCoordinates(rawCoordinates) {
  const coordinates = tile.parseCoordinates(rawCoordinates, {
    maxZoom: MAX_ZOOM,
  });

  if (coordinates.zoom < MIN_ZOOM) {
    throw new ValidationError({
      message: `O zoom "${coordinates.zoom}" é baixo demais para estabelecimentos.`,
      action: `Use um zoom entre ${MIN_ZOOM} e ${MAX_ZOOM}.`,
    });
  }

  return coordinates;
}

// Quantas letras a busca exige antes de responder.
//
// Duas. Com uma só, "a" casa com metade da tabela e a lista de sugestões vira
// uma amostra do país inteiro — e ainda custa a varredura para montá-la. Duas
// já recortam o bastante para a lista dizer alguma coisa.
const MIN_SEARCH_LENGTH = 2;

// Quantas sugestões a busca devolve.
//
// Oito, que é o que cabe embaixo da barra de busca sem cobrir o mapa. Não é
// paginação: quem não achou nas oito primeiras precisa digitar mais, não
// rolar uma lista.
const MAX_SEARCH_RESULTS = 8;

// O que o cliente pode mandar como coordenada, para ordenar por perto.
const LATITUDE_LIMIT = 90;
const LONGITUDE_LIMIT = 180;

function parseSearch(query) {
  const term = (query.q ?? "").trim();

  if (term.length < MIN_SEARCH_LENGTH) {
    throw new ValidationError({
      message: "A busca precisa de pelo menos duas letras.",
      action: "Digite mais um caractere e tente de novo.",
    });
  }

  return {
    term,
    ...parseOrigin(query),
  };
}

// De onde se está procurando. Opcional: sem ela a lista sai em ordem
// alfabética, que é pior mas continua sendo uma lista.
//
// Vem do cliente porque é ele que sabe: o servidor só veria o IP, que numa
// rede móvel aponta para a operadora e não para a esquina.
function parseOrigin(query) {
  const hasOrigin = query.lat !== undefined || query.lon !== undefined;

  if (!hasOrigin) {
    return { latitude: null, longitude: null };
  }

  const latitude = Number(query.lat);
  const longitude = Number(query.lon);

  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= LATITUDE_LIMIT &&
    Math.abs(longitude) <= LONGITUDE_LIMIT;

  if (!valid) {
    throw new ValidationError({
      message: `A origem "${query.lat},${query.lon}" não é uma coordenada.`,
      action: "Envie `lat` e `lon` em graus decimais, ou nenhum dos dois.",
    });
  }

  return { latitude, longitude };
}

// Os lugares cujo nome contém o que foi digitado, os mais perto primeiro.
//
// CONTÉM, e não começa com: quem digita "boteco" quer achar "O Boteco" também,
// e quem digita "pizza" espera a lista inteira de pizzarias. Quem começa com o
// termo aparece antes — é o casamento mais provável —, e o desempate é a
// distância a quem procura.
//
// Acento não conta, nos dois lados: "cafe" acha "Café" e "café" acha "Cafe".
// O teclado do Android não entrega acento ao aplicativo, e sem isto nenhum
// lugar com acento no nome era achado por lá. A comparação passa pela mesma
// "sem_acento" do índice — ver a migration "busca-sem-acento-em-places" —, e é
// isso que mantém a busca no índice em vez de varrer a tabela.
//
// A ordenação por distância usa graus, não metros: comparar quadrados de
// diferença basta para ordenar, e o cosseno da latitude corrige o encolhimento
// da longitude longe do equador. Uma raiz quadrada aqui só custaria tempo para
// devolver a mesma ordem.
async function search({ term, latitude, longitude }) {
  const hasOrigin = latitude !== null && longitude !== null;

  const values = [`%${escapeLike(term)}%`, `${escapeLike(term)}%`];
  if (hasOrigin) {
    values.push(latitude, longitude);
  }
  values.push(MAX_SEARCH_RESULTS);

  // A ordem, em pedaços: primeiro quem começa com o termo, depois — só quando
  // se sabe de onde a pessoa procura — a distância até ela, e o nome como
  // desempate final.
  //
  // Sem origem o pedaço do meio some da lista em vez de virar uma constante:
  // `ORDER BY 0` no Postgres é a POSIÇÃO da coluna zero, não o número zero, e
  // a consulta inteira falha.
  const ordering = [`(sem_acento(name) ILIKE sem_acento($2) ESCAPE '\\') DESC`];
  if (hasOrigin) {
    ordering.push(`(latitude - $3) * (latitude - $3)
        + (longitude - $4) * (longitude - $4)
        * power(cos(radians($3)), 2)`);
  }
  ordering.push("name");

  const results = await database.query({
    text: `
      SELECT
        id,
        name,
        category,
        latitude,
        longitude,
        street,
        neighborhood,
        locality,
        region,
        postcode
      FROM
        places
      WHERE
        sem_acento(name) ILIKE sem_acento($1) ESCAPE '\\'
        AND hidden_at IS NULL
      ORDER BY
        ${ordering.join(",\n        ")}
      LIMIT
        $${values.length}
    ;`,
    values,
  });

  return results.rows;
}

// `%`, `_` e a própria barra são curingas do LIKE. Sem escapar, procurar por
// "100%" traria a tabela inteira, e um nome com underscore casaria com
// qualquer letra no lugar dele.
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// O endereço viaja no TILE, e não só na busca.
//
// O aplicativo abre um painel quando se toca no marcador do restaurante, e o
// endereço é o conteúdo dele. Os marcadores vêm daqui — do tile —, então sem o
// endereço nesta consulta o painel teria de fazer uma segunda requisição por
// toque, para buscar pelo nome um lugar que ele já tem na mão.
//
// Custa cerca de sessenta bytes por lugar: uns dez quilobytes num tile cheio,
// que a borda guarda por trinta dias junto do resto da resposta.
//
// A ordem é pelo `id`, e não pelo nome, porque é ela que decide quem cai
// quando o tile passa de `MAX_PLACES_PER_TILE`. Em ordem alfabética o corte
// apagava um pedaço do ALFABETO: na Liberdade, em z15, tudo depois de
// "SnowFall Brasil" sumia do mapa — Udon Jinbei, Thai Chef, Sushi Kenzo. O id
// é um UUID aleatório, então o corte vira uma amostra espalhada pelo tile
// inteiro, a mesma a cada pedido, e sai do índice da chave primária.
//
// O que está oculto não entra — fechou, é duplicata de outro ou sumiu da
// fonte; ver a migration "ocultar-places-em-vez-de-apagar". A busca aplica o
// mesmo filtro.
//
// `has_menu` diz se alguém já mandou o cardápio do lugar. Viaja no tile pelo
// mesmo motivo do endereço: o aplicativo pinta de outra cor o marcador de
// quem tem cardápio, e o painel do lugar oferece vê-lo — perguntar por lugar
// seria uma requisição por marcador. O tile fica uma hora na borda, e por isso
// guardar um cardápio apaga de lá os tiles do lugar — ver `cacheTagsOf`.
async function findWithinTile(coordinates) {
  const { west, east, south, north } = tile.bounds(coordinates);

  const results = await database.query({
    text: `
      SELECT
        id,
        name,
        category,
        latitude,
        longitude,
        street,
        neighborhood,
        locality,
        region,
        postcode,
        EXISTS (
          SELECT
            1
          FROM
            menus
          WHERE
            menus.place_id = places.id
        ) AS has_menu
      FROM
        places
      WHERE
        latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
        AND hidden_at IS NULL
      ORDER BY
        id
      LIMIT
        $5
    ;`,
    values: [south, north, west, east, MAX_PLACES_PER_TILE],
  });

  return results.rows;
}

// O nome pelo qual a borda da Vercel guarda a resposta de um tile de lugares,
// para que ela possa ser apagada de lá antes do prazo — ver `infra/cdn.js`.
//
// Por TILE, e não por lugar: um tile traz até `MAX_PLACES_PER_TILE` lugares, e
// a borda aceita 128 etiquetas por resposta.
function cacheTag({ zoom, column, row }) {
  return `places-${zoom}-${column}-${row}`;
}

// As etiquetas de todos os tiles em que um lugar viaja: um por zoom que a rota
// aceita. O aplicativo pede os lugares em z16 com o mapa afastado e no zoom do
// próprio tile de perto, e cada um deles é uma resposta à parte na borda — com
// o seu prazo.
function cacheTagsOf({ latitude, longitude }) {
  const tags = [];
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom++) {
    tags.push(cacheTag(tile.containing({ latitude, longitude }, zoom)));
  }
  return tags;
}

// Etiqueta da página pública de compartilhamento do lugar na borda.
function shareCacheTag(id) {
  return `place-share-${id}`;
}

// Um lugar pelo id, visível ou não — quem chama decide o que fazer com o
// oculto. Sem o lugar, `NotFoundError`, com o texto que o aplicativo mostra.
async function findOneById(id) {
  // Id que nem tem forma de UUID não existe, e passá-lo ao Postgres viraria
  // erro de sintaxe — um 500 no lugar do 404.
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw placeNotFound();
  }

  const results = await database.query({
    text: `
      SELECT
        *
      FROM
        places
      WHERE
        id = $1
      LIMIT
        1
    ;`,
    values: [id],
  });

  if (results.rowCount === 0) {
    throw placeNotFound();
  }

  return results.rows[0];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BRAZIL = { west: -75, south: -35, east: -32, north: 6 };
const TEXT_FIELDS = [
  "name",
  "category",
  "street",
  "neighborhood",
  "postcode",
  "locality",
  "region",
];
const OPTIONAL_TEXT_FIELDS = TEXT_FIELDS.filter((field) => field !== "name");
const ADMIN_PLACE_FIELDS = [...TEXT_FIELDS, "latitude", "longitude"];
const MAX_TEXT_LENGTH = 200;
const ADMIN_PAGE_MAX = 50;
const ADMIN_HIDDEN_REASONS = [
  "admin_removed",
  "reported_closed",
  "reported_duplicate",
  "closed",
  "duplicate",
];

function placeNotFound() {
  return new NotFoundError({
    message: "O lugar informado não foi encontrado.",
    action: "Verifique se o lugar ainda aparece no mapa e tente de novo.",
  });
}

function parseAdminPlaceInput(input, { requireCoreFields = true } = {}) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError({
      message: "Os dados do estabelecimento precisam ser um objeto.",
      action: `Envie apenas os campos do local: ${ADMIN_PLACE_FIELDS.join(", ")}.`,
    });
  }

  const unknown = Object.keys(input).filter(
    (key) => !ADMIN_PLACE_FIELDS.includes(key),
  );
  if (unknown.length > 0) {
    throw new ValidationError({
      message: `Campo desconhecido no estabelecimento: ${unknown.join(", ")}.`,
      action: `Use apenas: ${ADMIN_PLACE_FIELDS.join(", ")}.`,
    });
  }

  const parsed = {};

  if (requireCoreFields || input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new ValidationError({
        message: "O nome do estabelecimento não foi informado.",
        action: "Informe um nome válido para o estabelecimento.",
      });
    }
    const name = input.name.trim().normalize("NFC");
    if (name.length > MAX_TEXT_LENGTH) {
      throw new ValidationError({
        message: `O nome passa de ${MAX_TEXT_LENGTH} caracteres.`,
        action: "Encurte o nome e tente de novo.",
      });
    }
    parsed.name = name;
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (input[field] === undefined) continue;
    const raw = input[field];
    if (raw === null || (typeof raw === "string" && raw.trim().length === 0)) {
      parsed[field] = null;
      continue;
    }
    if (typeof raw !== "string") {
      throw new ValidationError({
        message: `O campo "${field}" precisa ser um texto.`,
        action: "Envie texto ou deixe o campo em branco.",
      });
    }
    const text = raw.trim().normalize("NFC");
    if (text.length > MAX_TEXT_LENGTH) {
      throw new ValidationError({
        message: `O campo "${field}" passa de ${MAX_TEXT_LENGTH} caracteres.`,
        action: "Encurte o texto e tente de novo.",
      });
    }
    parsed[field] = text;
  }

  const hasLat = input.latitude !== undefined;
  const hasLon = input.longitude !== undefined;
  if (hasLat !== hasLon || (requireCoreFields && !hasLat)) {
    throw new ValidationError({
      message: "A localização exige latitude e longitude juntas.",
      action: "Informe latitude e longitude dentro do Brasil.",
    });
  }

  if (hasLat) {
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    const inBrazil =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= BRAZIL.south &&
      latitude <= BRAZIL.north &&
      longitude >= BRAZIL.west &&
      longitude <= BRAZIL.east;

    if (!inBrazil) {
      throw new ValidationError({
        message: `A posição "${input.latitude},${input.longitude}" fica fora do Brasil.`,
        action: "Confira no mapa se latitude e longitude não estão invertidas.",
      });
    }

    parsed.latitude = latitude;
    parsed.longitude = longitude;
  }

  return parsed;
}

function normalizeAdminPagination(query) {
  const rawPage = Number.parseInt(query?.page ?? "1", 10);
  const rawLimit = Number.parseInt(query?.limit ?? "25", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), ADMIN_PAGE_MAX)
    : 25;
  return { page, limit, offset: (page - 1) * limit };
}

function addPlaceTermCondition(
  term,
  mode,
  visibility,
  conditions,
  values,
  { matchId = false } = {},
) {
  const likeValue = `%${escapeLike(term)}%`;
  values.push(likeValue);
  const p = `$${values.length}`;

  const nameMatch =
    visibility === "visible"
      ? `sem_acento(places.name) ILIKE sem_acento(${p}) ESCAPE '\\'`
      : visibility === "hidden"
        ? `sem_acento(places.name) ILIKE sem_acento(${p}) ESCAPE '\\'`
        : `((places.hidden_at IS NULL AND sem_acento(places.name) ILIKE sem_acento(${p}) ESCAPE '\\') OR (places.hidden_at IS NOT NULL AND sem_acento(places.name) ILIKE sem_acento(${p}) ESCAPE '\\'))`;

  const addressMatch = `sem_acento_endereco(places.street, places.neighborhood, places.locality, places.region, places.postcode) ILIKE sem_acento(${p}) ESCAPE '\\'`;

  const parts = [];
  if (mode === "name" || mode === "both") {
    parts.push(nameMatch);
  }
  if (mode === "address" || mode === "both") {
    parts.push(addressMatch);
  }
  if (matchId && UUID_PATTERN.test(term)) {
    values.push(term);
    parts.push(`places.id = $${values.length}::uuid`);
  }

  conditions.push(`(${parts.join(" OR ")})`);
}

async function searchForAdmin(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const name = typeof query.name === "string" ? query.name.trim() : "";
  const address = typeof query.address === "string" ? query.address.trim() : "";
  const visibility = ["all", "visible", "hidden"].includes(query.visibility)
    ? query.visibility
    : "all";
  const hasMenu = ["all", "true", "false"].includes(query.has_menu)
    ? query.has_menu
    : "all";
  const { page, limit, offset } = normalizeAdminPagination(query);

  const conditions = [];
  const values = [];

  if (visibility === "visible") {
    conditions.push("places.hidden_at IS NULL");
  } else if (visibility === "hidden") {
    conditions.push("places.hidden_at IS NOT NULL");
  }

  if (q.length > 0) {
    if (q.length < MIN_SEARCH_LENGTH && !UUID_PATTERN.test(q)) {
      throw new ValidationError({
        message: "A busca precisa de pelo menos duas letras.",
        action: "Digite mais caracteres ou informe o UUID do estabelecimento.",
      });
    }
    addPlaceTermCondition(q, "both", visibility, conditions, values, {
      matchId: true,
    });
  }

  if (name.length > 0) {
    if (name.length < MIN_SEARCH_LENGTH) {
      throw new ValidationError({
        message: "O filtro de nome precisa de pelo menos duas letras.",
        action: "Digite mais um caractere no campo de nome.",
      });
    }
    addPlaceTermCondition(name, "name", visibility, conditions, values);
  }

  if (address.length > 0) {
    if (address.length < MIN_SEARCH_LENGTH) {
      throw new ValidationError({
        message: "O filtro de endereço precisa de pelo menos duas letras.",
        action: "Digite mais um caractere no campo de endereço.",
      });
    }
    addPlaceTermCondition(address, "address", visibility, conditions, values);
  }

  if (hasMenu === "true") {
    conditions.push("places.id IN (SELECT DISTINCT menus.place_id FROM menus)");
  } else if (hasMenu === "false") {
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM menus WHERE menus.place_id = places.id)",
    );
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const isFiltered =
    q.length > 0 ||
    name.length > 0 ||
    address.length > 0 ||
    visibility === "hidden" ||
    hasMenu === "true";

  // Em listagem aberta sem filtro, evita count(*) e sort em 600 mil linhas.
  const orderBy =
    visibility === "hidden"
      ? "ORDER BY places.hidden_at DESC, places.id DESC"
      : isFiltered
        ? "ORDER BY places.name ASC, places.id ASC"
        : "ORDER BY places.id ASC";

  let total = null;
  if (isFiltered) {
    const countResult = await database.query({
      text: `SELECT count(*)::int AS total FROM places ${whereClause};`,
      values,
    });
    total = countResult.rows[0].total;
  }

  const rowsResult = await database.query({
    text: `
      SELECT
        places.id,
        places.source,
        places.source_id,
        places.name,
        places.category,
        places.latitude,
        places.longitude,
        places.street,
        places.neighborhood,
        places.locality,
        places.region,
        places.postcode,
        places.hidden_at,
        places.hidden_reason,
        places.duplicate_of,
        places.created_at,
        places.updated_at,
        EXISTS (
          SELECT 1 FROM menus WHERE menus.place_id = places.id
        ) AS has_menu
      FROM
        places
      ${whereClause}
      ${orderBy}
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    ;`,
    values: [...values, limit + 1, offset],
  });

  const hasNext = rowsResult.rows.length > limit;
  const items = hasNext ? rowsResult.rows.slice(0, limit) : rowsResult.rows;

  return {
    items,
    total,
    has_next: hasNext,
    page,
    limit,
  };
}

async function createByAdmin(input) {
  const values = parseAdminPlaceInput(input, { requireCoreFields: true });
  const id = crypto.randomUUID();
  const overrides = {};
  for (const field of ADMIN_PLACE_FIELDS) {
    if (values[field] !== undefined && values[field] !== null) {
      overrides[field] = values[field];
    }
  }

  const result = await database.query({
    text: `
      INSERT INTO
        places (
          id, source, source_id, name, category, latitude, longitude,
          street, neighborhood, postcode, locality, region, overrides
        )
      VALUES
        ($1, 'admin', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      RETURNING
        *
    ;`,
    values: [
      id,
      id,
      values.name,
      values.category ?? null,
      values.latitude,
      values.longitude,
      values.street ?? null,
      values.neighborhood ?? null,
      values.postcode ?? null,
      values.locality ?? null,
      values.region ?? null,
      JSON.stringify(overrides),
    ],
  });

  const created = result.rows[0];
  cdn.forget(cacheTagsOf(created));
  return created;
}

async function updateByAdmin(id, input) {
  await findOneById(id);
  const changes = parseAdminPlaceInput(input, { requireCoreFields: false });
  const fields = Object.keys(changes);

  if (fields.length === 0) {
    throw new ValidationError({
      message: "Nenhum campo do estabelecimento foi informado para alteração.",
      action: `Envie ao menos um destes: ${ADMIN_PLACE_FIELDS.join(", ")}.`,
    });
  }

  const { before, after } = await database.withTransaction(async (client) => {
    const existing = await client.query({
      text: "SELECT latitude, longitude, overrides FROM places WHERE id = $1 FOR UPDATE;",
      values: [id],
    });

    if (existing.rowCount === 0) {
      throw placeNotFound();
    }

    const currentOverrides = existing.rows[0].overrides || {};
    const nextOverrides = { ...currentOverrides };
    for (const field of fields) {
      if (changes[field] === null) {
        delete nextOverrides[field];
      } else {
        nextOverrides[field] = changes[field];
      }
    }

    const assignments = fields.map(
      (field, index) => `${field} = $${index + 3}`,
    );
    const updated = await client.query({
      text: `
        UPDATE
          places
        SET
          ${assignments.join(",\n          ")},
          overrides = $2::jsonb,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
        RETURNING
          *
      ;`,
      values: [
        id,
        JSON.stringify(nextOverrides),
        ...fields.map((field) => changes[field]),
      ],
    });

    return { before: existing.rows[0], after: updated.rows[0] };
  });

  const tags = [
    ...new Set([
      ...cacheTagsOf(before),
      ...cacheTagsOf(after),
      shareCacheTag(after.id),
      `menu-${after.id}`,
    ]),
  ];
  cdn.forget(tags);

  return after;
}

async function hideByAdmin(
  id,
  { reason = "admin_removed", duplicateOf = null } = {},
) {
  const existing = await findOneById(id);

  if (!ADMIN_HIDDEN_REASONS.includes(reason)) {
    throw new ValidationError({
      message: `O motivo de ocultação "${reason}" não é válido.`,
      action: `Use um destes: ${ADMIN_HIDDEN_REASONS.join(", ")}.`,
    });
  }

  const isDuplicate = reason === "duplicate" || reason === "reported_duplicate";
  let targetDuplicateId = null;

  if (isDuplicate) {
    if (!duplicateOf || duplicateOf === existing.id) {
      throw new ValidationError({
        message: "Informe o outro estabelecimento que permanece ativo no mapa.",
        action: "Selecione o ID de outro local válido para marcar duplicata.",
      });
    }
    const kept = await findOneById(duplicateOf);
    if (kept.hidden_at !== null) {
      throw new ValidationError({
        message: "O estabelecimento principal da duplicata também está oculto.",
        action: "Escolha um estabelecimento visível no mapa.",
      });
    }
    targetDuplicateId = kept.id;
  }

  const result = await database.query({
    text: `
      UPDATE
        places
      SET
        hidden_at = timezone('utc', now()),
        hidden_reason = $2,
        duplicate_of = $3,
        updated_at = timezone('utc', now())
      WHERE
        id = $1
      RETURNING
        *
    ;`,
    values: [existing.id, reason, targetDuplicateId],
  });

  const hidden = result.rows[0];
  cdn.forget([
    ...cacheTagsOf(hidden),
    shareCacheTag(hidden.id),
    `menu-${hidden.id}`,
  ]);
  return hidden;
}

async function restoreByAdmin(id) {
  await findOneById(id);

  const result = await database.query({
    text: `
      UPDATE
        places
      SET
        hidden_at = NULL,
        hidden_reason = NULL,
        duplicate_of = NULL,
        updated_at = timezone('utc', now())
      WHERE
        id = $1
      RETURNING
        *
    ;`,
    values: [id],
  });

  const restored = result.rows[0];
  cdn.forget([
    ...cacheTagsOf(restored),
    shareCacheTag(restored.id),
    `menu-${restored.id}`,
  ]);
  return restored;
}

async function erasePhysicalByAdmin(id) {
  const existing = await findOneById(id);

  if (existing.source !== "admin") {
    throw new ConflictError({
      message:
        "Estabelecimentos importados ou sugeridos devem ser ocultados, e não apagados.",
      action:
        "Use a ocultação do painel para tirar o estabelecimento do mapa preservando o histórico.",
    });
  }

  const deleted = await database.withTransaction(async (client) => {
    const refCheck = await client.query({
      text: `
        SELECT
          EXISTS (SELECT 1 FROM menus WHERE place_id = $1) AS has_menus,
          EXISTS (
            SELECT 1 FROM place_suggestions
            WHERE place_id = $1 OR duplicate_of = $1
          ) AS has_suggestions
      ;`,
      values: [existing.id],
    });

    if (refCheck.rows[0].has_menus || refCheck.rows[0].has_suggestions) {
      throw new ConflictError({
        message:
          "Este local já possui cardápios ou sugestões vinculadas e precisa ser ocultado.",
        action:
          "Use a opção de ocultar para removê-lo do mapa sem perder o histórico.",
      });
    }

    const removed = await client.query({
      text: "DELETE FROM places WHERE id = $1 RETURNING *;",
      values: [existing.id],
    });

    return removed.rows[0];
  });

  cdn.forget([
    ...cacheTagsOf(deleted),
    shareCacheTag(deleted.id),
    `menu-${deleted.id}`,
  ]);

  return deleted;
}

const place = {
  MIN_ZOOM,
  MAX_ZOOM,
  MAX_PLACES_PER_TILE,
  MIN_SEARCH_LENGTH,
  MAX_SEARCH_RESULTS,
  parseCoordinates,
  findWithinTile,
  cacheTag,
  cacheTagsOf,
  shareCacheTag,
  parseSearch,
  parseOrigin,
  search,
  searchForAdmin,
  findOneById,
  createByAdmin,
  updateByAdmin,
  hideByAdmin,
  restoreByAdmin,
  erasePhysicalByAdmin,
  UUID_PATTERN,
};

export default place;
