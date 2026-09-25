import database from "infra/database.js";
import authorization from "models/authorization.js";
import place from "models/place.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "infra/errors.js";

// A fila de sugestões sobre os lugares do mapa — ver a migration
// "create-place-suggestions" para o porquê de uma fila, e para o que cada tipo
// faz ao ser aceito.

const KINDS = ["create", "update", "close", "duplicate"];

const STATUSES = ["pending", "accepted", "rejected"];

// Os campos de um lugar que uma sugestão pode trazer. São os de `places`, e
// só eles: campo desconhecido volta 400 em vez de ser descartado em silêncio,
// que diria "ok" a um pedido que não foi atendido.
const TEXT_FIELDS = [
  "name",
  "category",
  "street",
  "neighborhood",
  "postcode",
  "locality",
  "region",
];
const POSITION_FIELDS = ["latitude", "longitude"];
const FIELDS = [...TEXT_FIELDS, ...POSITION_FIELDS];

// Um nome de restaurante não passa disto, e um campo de texto sem teto é
// convite a guardar qualquer coisa no banco.
const MAX_TEXT_LENGTH = 200;

// A caixa do Brasil, a mesma da carga. Trocar latitude com longitude põe o
// lugar no oceano Índico, sem erro nenhum.
const BRAZIL = { west: -75, south: -35, east: -32, north: 6 };

// Quantas sugestões uma listagem devolve. A fila não é paginada ainda: quem
// revisa trabalha nas mais antigas, e elas vêm primeiro.
const PAGE_SIZE = 50;

// A feature que cada tipo exige. Cadastrar e corrigir são poderes diferentes:
// dá para tirar um sem tirar o outro de uma conta que abusou.
function featureFor(kind) {
  return kind === "create" ? "create:place" : "update:place";
}

async function create(user, input) {
  const kind = input?.kind;

  if (!KINDS.includes(kind)) {
    throw new ValidationError({
      message: `O tipo de sugestão "${kind}" não existe.`,
      action: `Use um destes: ${KINDS.join(", ")}.`,
    });
  }

  if (!authorization.can(user, featureFor(kind))) {
    throw new ForbiddenError({
      message: "Você não possui permissão para executar esta ação.",
      action: `Verifique se o seu usuário possui a feature "${featureFor(kind)}"`,
    });
  }

  const values = await parseInput(kind, input);

  const result = await database.query({
    text: `
      INSERT INTO
        place_suggestions (kind, place_id, duplicate_of, changes, created_by)
      VALUES
        ($1, $2, $3, $4, $5)
      RETURNING
        *
    ;`,
    values: [
      kind,
      values.placeId,
      values.duplicateOf,
      JSON.stringify(values.changes),
      user.id,
    ],
  });

  const suggestion = result.rows[0];

  // Quem revisa não precisa revisar a si mesmo: a sugestão de quem tem
  // `manage:place` já entra aceita, e o registro de quem aceitou fica igual.
  if (authorization.can(user, "manage:place")) {
    return await review(user, suggestion.id, "accepted");
  }

  return suggestion;
}

async function parseInput(kind, input) {
  const unknownKeys = Object.keys(input).filter(
    (key) => !["kind", "place_id", "duplicate_of", "changes"].includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError({
      message: `Campo desconhecido na sugestão: ${unknownKeys.join(", ")}.`,
      action: "Envie só kind, place_id, duplicate_of e changes.",
    });
  }

  if (kind === "create") {
    const changes = parseChanges(input.changes);
    for (const required of ["name", "latitude", "longitude"]) {
      if (changes[required] === undefined) {
        throw new ValidationError({
          message: `Falta "${required}" no lugar sugerido.`,
          action: "Um lugar novo precisa de nome e de posição no mapa.",
        });
      }
    }
    return { placeId: null, duplicateOf: null, changes };
  }

  const target = await findVisiblePlace(input.place_id);

  if (kind === "update") {
    const changes = parseChanges(input.changes);
    if (Object.keys(changes).length === 0) {
      throw new ValidationError({
        message: "A correção não muda nenhum campo.",
        action: `Envie em "changes" pelo menos um destes: ${FIELDS.join(", ")}.`,
      });
    }
    return { placeId: target.id, duplicateOf: null, changes };
  }

  if (kind === "duplicate") {
    const original = await findVisiblePlace(input.duplicate_of);
    if (original.id === target.id) {
      throw new ValidationError({
        message: "Um lugar não pode ser duplicata dele mesmo.",
        action: 'Envie em "duplicate_of" o outro lugar, o que deve ficar.',
      });
    }
    return { placeId: target.id, duplicateOf: original.id, changes: {} };
  }

  return { placeId: target.id, duplicateOf: null, changes: {} };
}

// Só se sugere sobre o que está no mapa: o oculto já saiu, e sugerir sobre
// ele é sugerir sobre algo que a pessoa não pode estar vendo.
async function findVisiblePlace(id) {
  const found = await place.findOneById(id);

  if (found.hidden_at !== null) {
    throw new NotFoundError({
      message: "O lugar informado não está mais no mapa.",
      action: "Atualize o mapa e tente de novo.",
    });
  }

  return found;
}

function parseChanges(changes) {
  if (changes === undefined || changes === null) {
    return {};
  }

  if (typeof changes !== "object" || Array.isArray(changes)) {
    throw new ValidationError({
      message: 'O campo "changes" precisa ser um objeto.',
      action: `Envie os campos do lugar: ${FIELDS.join(", ")}.`,
    });
  }

  const unknown = Object.keys(changes).filter((key) => !FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError({
      message: `Campo desconhecido em "changes": ${unknown.join(", ")}.`,
      action: `Use só estes: ${FIELDS.join(", ")}.`,
    });
  }

  const parsed = {};

  for (const field of TEXT_FIELDS) {
    if (changes[field] === undefined) continue;

    const value = changes[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ValidationError({
        message: `O campo "${field}" precisa ser um texto.`,
        action: "Preencha o campo ou deixe-o de fora da sugestão.",
      });
    }
    if (value.trim().length > MAX_TEXT_LENGTH) {
      throw new ValidationError({
        message: `O campo "${field}" passa de ${MAX_TEXT_LENGTH} caracteres.`,
        action: "Encurte o texto e tente de novo.",
      });
    }

    // NFC como no resto do dado: acento decomposto seria outro nome para a
    // busca e para o atlas de glifos do aplicativo.
    parsed[field] = value.trim().normalize("NFC");
  }

  // Posição anda em par: mover só a latitude de um lugar o põe noutra rua.
  const hasLatitude = changes.latitude !== undefined;
  const hasLongitude = changes.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    throw new ValidationError({
      message: "A posição precisa de latitude e longitude juntas.",
      action: "Envie as duas, ou nenhuma.",
    });
  }
  if (hasLatitude) {
    const { latitude, longitude } = changes;
    const inBrazil =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= BRAZIL.south &&
      latitude <= BRAZIL.north &&
      longitude >= BRAZIL.west &&
      longitude <= BRAZIL.east;

    if (!inBrazil) {
      throw new ValidationError({
        message: `A posição "${latitude},${longitude}" fica fora do Brasil.`,
        action: "Confira se latitude e longitude não estão trocadas.",
      });
    }
    parsed.latitude = latitude;
    parsed.longitude = longitude;
  }

  return parsed;
}

// Quem revisa vê a fila; quem sugere vê as próprias.
async function findAll(user, { status } = {}) {
  if (status !== undefined && !STATUSES.includes(status)) {
    throw new ValidationError({
      message: `O status "${status}" não existe.`,
      action: `Use um destes: ${STATUSES.join(", ")}.`,
    });
  }

  const manages = authorization.can(user, "manage:place");

  // A fila, para quem revisa, é das pendentes. Para quem sugere, sem filtro
  // são todas as dele — o que foi aceito e recusado também é resposta.
  const effectiveStatus = status ?? (manages ? "pending" : null);

  const results = await database.query({
    text: `
      SELECT
        *
      FROM
        place_suggestions
      WHERE
        ($1::text IS NULL OR status = $1)
        AND ($2::boolean OR created_by = $3)
      ORDER BY
        created_at ASC
      LIMIT
        $4
    ;`,
    values: [effectiveStatus, manages, user.id, PAGE_SIZE],
  });

  return results.rows;
}

// Aceita ou recusa, numa transação só: a sugestão e o que ela muda no lugar
// entram juntos ou não entram.
async function review(user, id, status) {
  if (!["accepted", "rejected"].includes(status)) {
    throw new ValidationError({
      message: `A revisão "${status}" não existe.`,
      action: 'Envie "accepted" para aceitar ou "rejected" para recusar.',
    });
  }

  if (typeof id !== "string" || !place.UUID_PATTERN.test(id)) {
    throw suggestionNotFound();
  }

  const client = await database.getNewClient();

  try {
    await client.query("BEGIN");

    const found = await client.query({
      text: "SELECT * FROM place_suggestions WHERE id = $1 FOR UPDATE;",
      values: [id],
    });

    if (found.rowCount === 0) {
      throw suggestionNotFound();
    }

    const suggestion = found.rows[0];

    if (suggestion.status !== "pending") {
      throw new ValidationError({
        message: "Esta sugestão já foi revisada.",
        action: "Atualize a fila e escolha uma sugestão pendente.",
      });
    }

    const placeId =
      status === "accepted"
        ? await apply(client, suggestion)
        : suggestion.place_id;

    const updated = await client.query({
      text: `
        UPDATE
          place_suggestions
        SET
          status = $2,
          place_id = $3,
          reviewed_by = $4,
          reviewed_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          id = $1
        RETURNING
          *
      ;`,
      values: [id, status, placeId, user.id],
    });

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

// O que cada tipo aceito faz no lugar. Devolve o id do lugar — no `create`, o
// do lugar que acabou de nascer.
async function apply(client, suggestion) {
  const changes = suggestion.changes;

  if (suggestion.kind === "create") {
    const created = await client.query({
      text: `
        INSERT INTO
          places (
            source, source_id, name, category, latitude, longitude,
            neighborhood, street, postcode, locality, region
          )
        VALUES
          ('usuario', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id
      ;`,
      values: [
        suggestion.id,
        changes.name,
        changes.category ?? null,
        changes.latitude,
        changes.longitude,
        changes.neighborhood ?? null,
        changes.street ?? null,
        changes.postcode ?? null,
        changes.locality ?? null,
        changes.region ?? null,
      ],
    });
    return created.rows[0].id;
  }

  if (suggestion.kind === "update") {
    // Os campos vão para as colunas E para `overrides`: as colunas são o que
    // a busca e o tile leem, e `overrides` é o que a próxima carga do Overture
    // reaplica por cima do que ela trouxer.
    const fields = Object.keys(changes);
    const assignments = fields.map((field, i) => `${field} = $${i + 3}`);

    await client.query({
      text: `
        UPDATE
          places
        SET
          ${assignments.join(",\n          ")},
          overrides = overrides || $2::jsonb,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
      ;`,
      values: [
        suggestion.place_id,
        JSON.stringify(changes),
        ...fields.map((field) => changes[field]),
      ],
    });
    return suggestion.place_id;
  }

  const reason =
    suggestion.kind === "close" ? "reported_closed" : "reported_duplicate";

  await client.query({
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
    ;`,
    values: [suggestion.place_id, reason, suggestion.duplicate_of],
  });
  return suggestion.place_id;
}

function suggestionNotFound() {
  return new NotFoundError({
    message: "A sugestão informada não foi encontrada.",
    action: "Atualize a fila e tente de novo.",
  });
}

const placeSuggestion = {
  create,
  findAll,
  review,
};

export default placeSuggestion;
