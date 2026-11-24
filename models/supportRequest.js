import database from "infra/database.js";
import { NotFoundError, ValidationError } from "infra/errors.js";
import { CONTATO_SUPORTE } from "lib/identidade.js";
import place from "models/place.js";

const CATEGORIES = ["missing_place", "general_help", "account_help"];
const STATUSES = ["open", "in_progress", "resolved", "archived"];

const CREATE_KEYS = [
  "category",
  "contact_name",
  "contact_email",
  "account_identifier",
  "subject",
  "message",
  "place_name",
  "approximate_address",
  "latitude",
  "longitude",
];

const ADMIN_UPDATE_KEYS = ["status", "resolution_note", "resolved_place_id"];

const BRAZIL = { west: -75, south: -35, east: -32, north: 6 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_PAGE_MAX = 50;

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function cleanOptionalText(
  raw,
  { maxLength, fieldLabel, normalizeNfc = true },
) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new ValidationError({
      message: `O campo "${fieldLabel}" precisa ser um texto.`,
      action: "Preencha com texto válido ou deixe em branco.",
    });
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = normalizeNfc ? trimmed.normalize("NFC") : trimmed;
  if (value.length > maxLength) {
    throw new ValidationError({
      message: `O campo "${fieldLabel}" passa de ${maxLength} caracteres.`,
      action: "Encurte o texto e tente de novo.",
    });
  }
  return value;
}

function parseOptionalEmail(raw) {
  const email = cleanOptionalText(raw, {
    maxLength: 254,
    fieldLabel: "e-mail de contato",
    normalizeNfc: false,
  });
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new ValidationError({
      message: "O e-mail de contato informado não é válido.",
      action: "Confira o endereço de e-mail e tente de novo.",
    });
  }
  return email;
}

function parseOptionalCoordinates(input) {
  const rawLat = input?.latitude;
  const rawLon = input?.longitude;
  const hasLat = rawLat !== undefined && rawLat !== null;
  const hasLon = rawLon !== undefined && rawLon !== null;

  if (hasLat !== hasLon) {
    throw new ValidationError({
      message: "A localização exige latitude e longitude juntas.",
      action: "Envie ambas as coordenadas ou deixe as duas em branco.",
    });
  }

  if (!hasLat) {
    return { latitude: null, longitude: null };
  }

  const latitude = Number(rawLat);
  const longitude = Number(rawLon);
  const inBrazil =
    typeof rawLat !== "boolean" &&
    typeof rawLon !== "boolean" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= BRAZIL.south &&
    latitude <= BRAZIL.north &&
    longitude >= BRAZIL.west &&
    longitude <= BRAZIL.east;

  if (!inBrazil) {
    throw new ValidationError({
      message: `A localização "${rawLat},${rawLon}" fica fora do Brasil.`,
      action: "Confira as coordenadas ou envie o pedido sem localização.",
    });
  }

  return { latitude, longitude };
}

function rejectUnknownKeys(input, allowedKeys, contextLabel) {
  const unknown = Object.keys(input).filter((k) => !allowedKeys.includes(k));
  if (unknown.length > 0) {
    throw new ValidationError({
      message: `Campo desconhecido ${contextLabel}: ${unknown.join(", ")}.`,
      action: `Envie apenas os campos aceitos (${allowedKeys.join(", ")}).`,
    });
  }
}

function validateCreateInput(user, rawInput) {
  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    Array.isArray(rawInput)
  ) {
    throw new ValidationError({
      message: "Os dados da solicitação precisam ser um objeto.",
      action: "Envie os campos da solicitação em formato JSON.",
    });
  }

  rejectUnknownKeys(rawInput, CREATE_KEYS, "na solicitação");

  const category = rawInput.category;
  if (!CATEGORIES.includes(category)) {
    throw new ValidationError({
      message: `A categoria "${category}" não é válida.`,
      action: `Use uma destas categorias: ${CATEGORIES.join(", ")}.`,
    });
  }

  const contactName = cleanOptionalText(rawInput.contact_name, {
    maxLength: 120,
    fieldLabel: "nome de contato",
  });
  const contactEmail = parseOptionalEmail(rawInput.contact_email);
  const accountIdentifier = cleanOptionalText(rawInput.account_identifier, {
    maxLength: 254,
    fieldLabel: "identificador da conta",
    normalizeNfc: false,
  });
  const subject = cleanOptionalText(rawInput.subject, {
    maxLength: 200,
    fieldLabel: "assunto",
  });
  const message = cleanOptionalText(rawInput.message, {
    maxLength: 2000,
    fieldLabel: "mensagem",
  });
  const placeName = cleanOptionalText(rawInput.place_name, {
    maxLength: 200,
    fieldLabel: "nome do estabelecimento",
  });
  const approximateAddress = cleanOptionalText(rawInput.approximate_address, {
    maxLength: 400,
    fieldLabel: "endereço aproximado",
  });
  const { latitude, longitude } = parseOptionalCoordinates(rawInput);

  if (category === "missing_place") {
    if (!placeName) {
      throw new ValidationError({
        message: "Informe o nome do estabelecimento que não foi encontrado.",
        action: "Preencha place_name para enviar a solicitação.",
      });
    }
    if (!approximateAddress) {
      throw new ValidationError({
        message: "Informe ao menos um endereço aproximado ou referência.",
        action: "Preencha approximate_address (rua, bairro ou ponto próximo).",
      });
    }
  } else {
    if (!message) {
      throw new ValidationError({
        message: "Descreva sua dúvida ou problema antes de enviar.",
        action: "Preencha o campo message com detalhes do pedido de ajuda.",
      });
    }
    if (!user?.id && !contactEmail) {
      throw new ValidationError({
        message:
          "Informe um e-mail de contato para retornarmos o pedido de ajuda.",
        action: "Preencha contact_email ou entre na sua conta antes de enviar.",
      });
    }
  }

  return {
    category,
    userId: user?.id || null,
    contactName,
    contactEmail,
    accountIdentifier: category === "account_help" ? accountIdentifier : null,
    subject,
    message,
    placeName: category === "missing_place" ? placeName : null,
    approximateAddress:
      category === "missing_place" ? approximateAddress : null,
    latitude: category === "missing_place" ? latitude : null,
    longitude: category === "missing_place" ? longitude : null,
  };
}

// Registra pedidos de novos locais e ajuda geral/de conta. Mesmo quando inclui
// local e GPS de referência, nunca cria ou altera `places` automaticamente.
async function create(user, rawInput) {
  const data = validateCreateInput(user, rawInput);

  const result = await database.query({
    text: `
      INSERT INTO
        support_requests (
          category, status, user_id, contact_name, contact_email,
          account_identifier, subject, message, place_name,
          approximate_address, latitude, longitude
        )
      VALUES
        ($1, 'open', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING
        *
    ;`,
    values: [
      data.category,
      data.userId,
      data.contactName,
      data.contactEmail,
      data.accountIdentifier,
      data.subject,
      data.message,
      data.placeName,
      data.approximateAddress,
      data.latitude,
      data.longitude,
    ],
  });

  return result.rows[0];
}

async function listForUser(userId, { limit = 25 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), ADMIN_PAGE_MAX);
  const result = await database.query({
    text: `
      SELECT
        *
      FROM
        support_requests
      WHERE
        user_id = $1
      ORDER BY
        created_at DESC,
        id DESC
      LIMIT
        $2
    ;`,
    values: [userId, safeLimit],
  });

  return result.rows;
}

function normalizePagination(query) {
  const rawPage = Number.parseInt(query?.page ?? "1", 10);
  const rawLimit = Number.parseInt(query?.limit ?? "12", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), ADMIN_PAGE_MAX)
    : 12;
  return { page, limit, offset: (page - 1) * limit };
}

async function listForAdmin(query = {}) {
  const category = CATEGORIES.includes(query?.category)
    ? query.category
    : "all";
  const status = STATUSES.includes(query?.status) ? query.status : "all";
  const q = typeof query?.q === "string" ? query.q.trim() : "";
  const { page, limit, offset } = normalizePagination(query);

  const conditions = [];
  const values = [];

  if (category !== "all") {
    values.push(category);
    conditions.push(`sr.category = $${values.length}`);
  }

  if (status !== "all") {
    values.push(status);
    conditions.push(`sr.status = $${values.length}`);
  }

  if (q.length > 0) {
    values.push(`%${escapeLike(q)}%`);
    const p = `$${values.length}`;
    if (place.UUID_PATTERN.test(q)) {
      values.push(q);
      const idP = `$${values.length}::uuid`;
      conditions.push(`(
        sr.id = ${idP}
        OR sr.user_id = ${idP}
        OR sr.resolved_place_id = ${idP}
        OR LOWER(COALESCE(sr.place_name, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.contact_email, '')) LIKE LOWER(${p}) ESCAPE '\\'
      )`);
    } else {
      conditions.push(`(
        LOWER(COALESCE(sr.place_name, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.approximate_address, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.subject, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.message, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.contact_email, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.contact_name, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(sr.account_identifier, '')) LIKE LOWER(${p}) ESCAPE '\\'
        OR LOWER(COALESCE(u.username, '')) LIKE LOWER(${p}) ESCAPE '\\'
      )`);
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countsResult, totalResult, rowsResult] = await Promise.all([
    database.query(`
      SELECT
        count(*) FILTER (WHERE status = 'open')::int AS open,
        count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        count(*) FILTER (WHERE status = 'archived')::int AS archived
      FROM
        support_requests
    ;`),
    database.query({
      text: `
        SELECT
          count(*)::int AS total
        FROM
          support_requests sr
          LEFT JOIN users u ON u.id = sr.user_id
        ${whereClause}
      ;`,
      values,
    }),
    database.query({
      text: `
        SELECT
          sr.*,
          u.username AS user_username,
          h.username AS handled_username,
          p.name AS resolved_place_name
        FROM
          support_requests sr
          LEFT JOIN users u ON u.id = sr.user_id
          LEFT JOIN users h ON h.id = sr.handled_by
          LEFT JOIN places p ON p.id = sr.resolved_place_id
        ${whereClause}
        ORDER BY
          CASE sr.status
            WHEN 'open' THEN 0
            WHEN 'in_progress' THEN 1
            WHEN 'resolved' THEN 2
            ELSE 3
          END,
          sr.created_at DESC,
          sr.id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      ;`,
      values: [...values, limit, offset],
    }),
  ]);

  return {
    items: rowsResult.rows,
    total: totalResult.rows[0].total,
    counts: countsResult.rows[0],
    page,
    limit,
  };
}

function requestNotFoundError() {
  return new NotFoundError({
    message: "A solicitação de suporte informada não foi encontrada.",
    action: "Atualize a fila de atendimento e tente novamente.",
  });
}

async function updateByAdmin(adminUser, id, rawInput) {
  if (typeof id !== "string" || !place.UUID_PATTERN.test(id)) {
    throw requestNotFoundError();
  }

  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    Array.isArray(rawInput)
  ) {
    throw new ValidationError({
      message: "Os dados de atualização precisam ser um objeto.",
      action: `Envie ao menos um destes campos: ${ADMIN_UPDATE_KEYS.join(", ")}.`,
    });
  }

  rejectUnknownKeys(rawInput, ADMIN_UPDATE_KEYS, "no atendimento");

  if (Object.keys(rawInput).length === 0) {
    throw new ValidationError({
      message: "Nenhuma alteração foi informada para o atendimento.",
      action: `Envie ao menos um destes campos: ${ADMIN_UPDATE_KEYS.join(", ")}.`,
    });
  }

  if (rawInput.status !== undefined && !STATUSES.includes(rawInput.status)) {
    throw new ValidationError({
      message: `A situação "${rawInput.status}" não é válida.`,
      action: `Use uma destas situações: ${STATUSES.join(", ")}.`,
    });
  }

  const hasNote = rawInput.resolution_note !== undefined;
  const note = hasNote
    ? cleanOptionalText(rawInput.resolution_note, {
        maxLength: 2000,
        fieldLabel: "nota de atendimento",
      })
    : undefined;

  const hasResolvedPlace = rawInput.resolved_place_id !== undefined;
  let resolvedPlaceId = undefined;
  if (hasResolvedPlace) {
    if (
      rawInput.resolved_place_id === null ||
      rawInput.resolved_place_id === ""
    ) {
      resolvedPlaceId = null;
    } else {
      const target = await place.findOneById(rawInput.resolved_place_id);
      resolvedPlaceId = target.id;
    }
  }

  const { previous, updated } = await database.withTransaction(
    async (client) => {
      const existing = await client.query({
        text: "SELECT * FROM support_requests WHERE id = $1 FOR UPDATE;",
        values: [id],
      });

      if (existing.rowCount === 0) {
        throw requestNotFoundError();
      }

      const current = existing.rows[0];
      const nextStatus = rawInput.status ?? current.status;
      const nextNote = hasNote ? note : current.resolution_note;
      const nextPlaceId = hasResolvedPlace
        ? resolvedPlaceId
        : current.resolved_place_id;
      const nextResolvedAt =
        nextStatus === "resolved" || nextStatus === "archived"
          ? current.resolved_at || new Date()
          : null;

      const saved = await client.query({
        text: `
        UPDATE
          support_requests
        SET
          status = $2,
          resolution_note = $3,
          resolved_place_id = $4,
          handled_by = $5,
          handled_at = timezone('utc', now()),
          resolved_at = $6,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
        RETURNING
          *
      ;`,
        values: [
          id,
          nextStatus,
          nextNote,
          nextPlaceId,
          adminUser.id,
          nextResolvedAt,
        ],
      });

      return { previous: current, updated: saved.rows[0] };
    },
  );

  const hydrated = await database.query({
    text: `
      SELECT
        sr.*,
        u.username AS user_username,
        h.username AS handled_username,
        p.name AS resolved_place_name
      FROM
        support_requests sr
        LEFT JOIN users u ON u.id = sr.user_id
        LEFT JOIN users h ON h.id = sr.handled_by
        LEFT JOIN places p ON p.id = sr.resolved_place_id
      WHERE
        sr.id = $1
      LIMIT 1
    ;`,
    values: [updated.id],
  });

  return { previous, updated: hydrated.rows[0] };
}

// Canal oficial de contato e orientações de ajuda (Cláusula 1.2) para consumo
// direto pelo aplicativo e telas de suporte sem duplicar texto em clientes.
function getSupportInfo() {
  const email = process.env.SUPPORT_CONTACT_EMAIL?.trim() || CONTATO_SUPORTE;
  const secondaryChannel = process.env.SUPPORT_CONTACT_URL?.trim() || null;

  return {
    contact: {
      email,
      secondary_url: secondaryChannel,
    },
    categories: [
      {
        id: "missing_place",
        title: "Não encontro o local",
        description:
          "Informe o nome e o endereço aproximado do estabelecimento. A localização do aparelho é usada apenas como referência opcional.",
      },
      {
        id: "account_help",
        title: "Ajuda com a conta",
        description:
          "Atendimento para dificuldades de acesso, confirmação de cadastro ou recuperação, inclusive sem estar autenticado.",
      },
      {
        id: "general_help",
        title: "Ajuda geral",
        description:
          "Dúvidas sobre o aplicativo, relatos de erro ou sugestões de atendimento.",
      },
    ],
    guidance: [
      {
        id: "cannot_sign_in",
        title: "Não consigo entrar na minha conta",
        steps: [
          "Tente recuperar a senha informando o e-mail cadastrado na tela inicial de entrada.",
          "Verifique sua caixa de spam ou lixo eletrônico caso o link não apareça em alguns minutos.",
          `Se continuar sem conseguir acessar, envie um pedido em Ajuda com a conta ou escreva para ${email}.`,
        ],
      },
      {
        id: "missing_place",
        title: "Estabelecimento não aparece no mapa",
        steps: [
          "Toque em Não encontro o local e informe o nome e a rua ou bairro aproximados.",
          "Autorize a localização se desejar enviar sua posição atual como referência.",
          "Nossa equipe valida as informações antes de publicar o estabelecimento no mapa.",
        ],
      },
    ],
  };
}

// Escalonamento sanitizado da recuperação sem e-mail (Cláusula 1.4): evita
// duplicar chamados em aberto quando o mesmo solicitante reenvia para o mesmo alvo.
async function createRecoveryEscalation({
  userId = null,
  contactEmail,
  accountIdentifier,
  subject,
  message,
  metadata = {},
}) {
  return await database.withTransaction(async (client) => {
    const isAbuse = metadata?.reason === "abuse_rate_limit";
    const existing = await client.query({
      text: `
        SELECT
          id,
          metadata
        FROM
          support_requests
        WHERE
          category = 'account_help'
          AND status IN ('open', 'in_progress')
          AND metadata->>'source' = 'recovery_without_email'
          AND (
            $4::boolean = true
            OR LOWER(COALESCE(contact_email, '')) = LOWER($1)
          )
          AND (
            ($2::uuid IS NOT NULL AND user_id = $2::uuid)
            OR LOWER(COALESCE(account_identifier, '')) = LOWER($3)
          )
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY
          created_at DESC
        LIMIT 1
        FOR UPDATE
      ;`,
      values: [contactEmail, userId, accountIdentifier, isAbuse],
    });

    if (existing.rowCount > 0) {
      const currentMeta = existing.rows[0].metadata || {};
      const nextCount = Number(currentMeta.attempt_count || 1) + 1;
      const mergedMeta = {
        ...currentMeta,
        ...metadata,
        attempt_count: nextCount,
      };

      const updated = await client.query({
        text: `
          UPDATE
            support_requests
          SET
            user_id = COALESCE(user_id, $2),
            message = $3,
            metadata = $4::jsonb,
            updated_at = timezone('utc', now())
          WHERE
            id = $1
          RETURNING
            *
        ;`,
        values: [
          existing.rows[0].id,
          userId,
          message,
          JSON.stringify(mergedMeta),
        ],
      });

      return updated.rows[0];
    }

    const initialMeta = {
      ...metadata,
      attempt_count: 1,
    };

    const inserted = await client.query({
      text: `
        INSERT INTO
          support_requests (
            category, status, user_id, contact_email,
            account_identifier, subject, message, metadata
          )
        VALUES
          ('account_help', 'open', $1, $2, $3, $4, $5, $6::jsonb)
        RETURNING
          *
      ;`,
      values: [
        userId,
        contactEmail,
        accountIdentifier,
        subject,
        message,
        JSON.stringify(initialMeta),
      ],
    });

    return inserted.rows[0];
  });
}

const supportRequest = {
  CATEGORIES,
  STATUSES,
  create,
  createRecoveryEscalation,
  listForUser,
  listForAdmin,
  updateByAdmin,
  getSupportInfo,
};

export default supportRequest;
