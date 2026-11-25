import database from "infra/database.js";
import { RateLimitError, ValidationError } from "infra/errors.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";
import emailChange from "models/emailChange.js";
import rateLimit from "models/rateLimit.js";
import supportRequest from "models/supportRequest.js";
import user from "models/user.js";

const UNIFORM_RESPONSE = {
  status: "received",
  message:
    "Recebemos sua solicitação de recuperação. Se os dados confirmarem a titularidade, enviaremos um link de confirmação para o novo e-mail informado; caso contrário, nossa equipe analisará o atendimento.",
};

const TARGET_RATE_LIMIT = 3;
const TARGET_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const PASSWORD_KEY_PATTERN = /(password|senha|passphrase)/i;
const MAX_SUBMITTED_PLACES = 5;

const ALLOWED_KEYS = [
  "account_identifier",
  "new_email",
  "known_old_email",
  "submitted_place_names",
  "activity_locality",
  "created_month",
  "notes",
];

// Palavras genéricas demais que não comprovam conhecimento específico do local
// quando enviadas sozinhas como correspondência parcial.
const GENERIC_PLACE_WORDS = new Set([
  "bar",
  "bistro",
  "cafe",
  "cafeteria",
  "churrascaria",
  "doceria",
  "hamburgueria",
  "lanchonete",
  "mercado",
  "padaria",
  "pastelaria",
  "pizzaria",
  "restaurante",
  "sorveteria",
]);

function normalizeComparable(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function parseSubmittedPlaces(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError({
      message: "O campo de estabelecimentos enviados precisa ser uma lista.",
      action: "Envie uma lista de nomes de estabelecimentos (até 5).",
    });
  }
  if (raw.length > MAX_SUBMITTED_PLACES) {
    throw new ValidationError({
      message: `Envie no máximo ${MAX_SUBMITTED_PLACES} nomes de estabelecimentos.`,
      action: "Reduza a lista de locais informados e tente novamente.",
    });
  }

  const seen = new Set();
  const parsed = [];
  for (const item of raw) {
    const cleaned = cleanOptionalText(item, {
      maxLength: 200,
      fieldLabel: "estabelecimento enviado",
    });
    if (!cleaned) continue;
    const norm = normalizeComparable(cleaned);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    parsed.push({ raw: cleaned, normalized: norm });
  }
  return parsed;
}

function parseInput(rawInput) {
  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    Array.isArray(rawInput)
  ) {
    throw new ValidationError({
      message: "Os dados da solicitação precisam ser um objeto.",
      action: "Envie as respostas do questionário em formato JSON.",
    });
  }

  const keys = Object.keys(rawInput);
  for (const key of keys) {
    if (PASSWORD_KEY_PATTERN.test(key)) {
      throw new ValidationError({
        message: "Nunca informe ou envie senhas anteriores neste questionário.",
        action:
          "Remova qualquer campo de senha e informe apenas os dados solicitados.",
      });
    }
  }

  const unknownKeys = keys.filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new ValidationError({
      message: `Campo desconhecido no questionário: ${unknownKeys.join(", ")}.`,
      action: `Envie apenas os campos aceitos (${ALLOWED_KEYS.join(", ")}).`,
    });
  }

  const accountIdentifier = cleanOptionalText(rawInput.account_identifier, {
    maxLength: 254,
    fieldLabel: "identificador da conta",
    normalizeNfc: false,
  });
  if (!accountIdentifier) {
    throw new ValidationError({
      message: "Informe o nome de usuário ou o e-mail da conta.",
      action: "Preencha account_identifier para localizar a conta.",
    });
  }

  const newEmail = user.normalizeAndValidateEmail(rawInput.new_email);

  let knownOldEmail = null;
  if (
    rawInput.known_old_email !== undefined &&
    rawInput.known_old_email !== null &&
    String(rawInput.known_old_email).trim() !== ""
  ) {
    knownOldEmail = user.normalizeAndValidateEmail(rawInput.known_old_email);
  }

  const submittedPlaces = parseSubmittedPlaces(rawInput.submitted_place_names);
  const activityLocality = cleanOptionalText(rawInput.activity_locality, {
    maxLength: 120,
    fieldLabel: "cidade de atividade",
  });

  const createdMonth = cleanOptionalText(rawInput.created_month, {
    maxLength: 7,
    fieldLabel: "mês de criação da conta",
    normalizeNfc: false,
  });
  if (createdMonth && !MONTH_PATTERN.test(createdMonth)) {
    throw new ValidationError({
      message: "O mês de criação da conta precisa seguir o formato AAAA-MM.",
      action: "Exemplo válido: 2026-08.",
    });
  }

  const notes = cleanOptionalText(rawInput.notes, {
    maxLength: 1000,
    fieldLabel: "observações",
  });

  return {
    accountIdentifier,
    newEmail,
    knownOldEmail,
    submittedPlaces,
    activityLocality,
    createdMonth,
    notes,
  };
}

function getQuestions() {
  return {
    instructions:
      "Informe os dados que lembrar da sua conta sem inserir senhas. Caso o histórico privado confirme a titularidade, enviaremos a confirmação para o novo e-mail; caso contrário, o pedido seguirá para análise da equipe.",
    never_request: [
      "Nunca informe senhas atuais ou anteriores neste formulário.",
    ],
    fields: [
      {
        id: "account_identifier",
        label: "Nome de usuário ou e-mail antigo da conta",
        type: "text",
        required: true,
        max_length: 254,
      },
      {
        id: "new_email",
        label: "Novo e-mail para receber o acesso",
        type: "email",
        required: true,
        max_length: 254,
      },
      {
        id: "known_old_email",
        label: "E-mail antigo completo cadastrado na conta (se lembrar)",
        type: "email",
        required: false,
        max_length: 254,
      },
      {
        id: "submitted_place_names",
        label:
          "Nomes de estabelecimentos para os quais você enviou cardápio ou sugestão",
        type: "string_array",
        required: false,
        max_items: MAX_SUBMITTED_PLACES,
      },
      {
        id: "activity_locality",
        label: "Cidade onde costuma enviar cardápios ou sugestões",
        type: "text",
        required: false,
        max_length: 120,
      },
      {
        id: "created_month",
        label: "Mês e ano aproximado de criação da conta (AAAA-MM)",
        type: "month",
        required: false,
      },
      {
        id: "notes",
        label: "Observações adicionais para atendimento (opcional, sem senhas)",
        type: "textarea",
        required: false,
        max_length: 1000,
      },
    ],
  };
}

function placeMatchesCandidate(submittedNormalized, candidateNormalized) {
  if (!submittedNormalized || !candidateNormalized) return false;
  if (submittedNormalized === candidateNormalized) return true;
  if (GENERIC_PLACE_WORDS.has(submittedNormalized)) return false;
  if (submittedNormalized.length < 5) return false;

  const shorter = Math.min(
    submittedNormalized.length,
    candidateNormalized.length,
  );
  const longer = Math.max(
    submittedNormalized.length,
    candidateNormalized.length,
  );
  if (shorter < longer * 0.45) return false;

  return (
    candidateNormalized.includes(submittedNormalized) ||
    submittedNormalized.includes(candidateNormalized)
  );
}

function isCreatedMonthCompatible(createdAt, monthStr) {
  if (!createdAt || !monthStr) return false;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;

  const [yearStr, mStr] = monthStr.split("-");
  const targetMonths = Number(yearStr) * 12 + (Number(mStr) - 1);

  const utcMonths = date.getUTCFullYear() * 12 + date.getUTCMonth();
  const brtDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const brtMonths = brtDate.getUTCFullYear() * 12 + brtDate.getUTCMonth();

  return (
    Math.abs(targetMonths - utcMonths) <= 1 ||
    Math.abs(targetMonths - brtMonths) <= 1
  );
}

async function findAccountByIdentifier(identifier) {
  const result = await database.query({
    text: `
      SELECT
        id,
        username,
        email,
        features,
        created_at,
        deleted_at
      FROM
        users
      WHERE
        deleted_at IS NULL
        AND (
          LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($1)
        )
      LIMIT 1
    ;`,
    values: [identifier],
  });

  return result.rows[0] || null;
}

async function loadPrivateSignals(userId) {
  const [menuPlacesRes, suggestionPlacesRes] = await Promise.all([
    database.query({
      text: `
        SELECT DISTINCT
          places.id,
          places.name,
          places.locality
        FROM
          menus
          INNER JOIN places ON places.id = menus.place_id
        WHERE
          menus.created_by = $1
      ;`,
      values: [userId],
    }),
    database.query({
      text: `
        SELECT
          ps.place_id,
          COALESCE(p.name, ps.changes->>'name') AS name,
          COALESCE(p.locality, ps.changes->>'locality') AS locality
        FROM
          place_suggestions ps
          LEFT JOIN places p ON p.id = ps.place_id
        WHERE
          ps.created_by = $1
      ;`,
      values: [userId],
    }),
  ]);

  const placeMap = new Map();
  const localities = new Set();

  for (const row of [...menuPlacesRes.rows, ...suggestionPlacesRes.rows]) {
    const normName = normalizeComparable(row.name || "");
    if (normName && !placeMap.has(normName)) {
      placeMap.set(normName, row.name);
    }
    const normLoc = normalizeComparable(row.locality || "");
    if (normLoc) {
      localities.add(normLoc);
    }
  }

  return {
    privatePlaceNames: Array.from(placeMap.keys()),
    localities,
  };
}

function evaluateOwnership(targetUser, signals, input) {
  if (!targetUser || targetUser.deleted_at) {
    return {
      approved: false,
      reason: "account_not_found_or_inactive",
      summary: {
        has_private_history: false,
        old_email_matched: false,
        places_matched_count: 0,
        reinforcement_matched: false,
      },
    };
  }

  if (
    authorization.can(targetUser, "read:activation_token") ||
    !authorization.can(targetUser, "create:session")
  ) {
    return {
      approved: false,
      reason: "unactivated_account",
      summary: {
        has_private_history: false,
        old_email_matched: false,
        places_matched_count: 0,
        reinforcement_matched: false,
      },
    };
  }

  if (authorization.can(targetUser, "admin")) {
    return {
      approved: false,
      reason: "admin_account_requires_manual_review",
      summary: {
        has_private_history: signals.privatePlaceNames.length > 0,
        old_email_matched: Boolean(
          input.knownOldEmail &&
          targetUser.email &&
          input.knownOldEmail.toLowerCase() === targetUser.email.toLowerCase(),
        ),
        places_matched_count: 0,
        reinforcement_matched: false,
      },
    };
  }

  const emailMatched = Boolean(
    input.knownOldEmail &&
    targetUser.email &&
    input.knownOldEmail.toLowerCase() === targetUser.email.toLowerCase(),
  );

  const matchedPrivatePlaces = new Set();
  for (const candidate of signals.privatePlaceNames) {
    for (const submitted of input.submittedPlaces) {
      if (placeMatchesCandidate(submitted.normalized, candidate)) {
        matchedPrivatePlaces.add(candidate);
        break;
      }
    }
  }

  const placesMatchedCount = matchedPrivatePlaces.size;
  const hasPrivateHistory = signals.privatePlaceNames.length > 0;
  const localityMatched = Boolean(
    input.activityLocality &&
    signals.localities.has(normalizeComparable(input.activityLocality)),
  );
  const createdMonthMatched = isCreatedMonthCompatible(
    targetUser.created_at,
    input.createdMonth,
  );
  const reinforcementMatched =
    signals.privatePlaceNames.length >= 2
      ? placesMatchedCount >= 2 || localityMatched || createdMonthMatched
      : localityMatched || createdMonthMatched;

  const summary = {
    has_private_history: hasPrivateHistory,
    old_email_matched: emailMatched,
    places_matched_count: placesMatchedCount,
    reinforcement_matched: reinforcementMatched,
  };

  if (!hasPrivateHistory) {
    return {
      approved: false,
      reason: "insufficient_private_history",
      summary,
    };
  }

  if (emailMatched && placesMatchedCount >= 1 && reinforcementMatched) {
    return {
      approved: true,
      reason: "verified_ownership",
      summary,
    };
  }

  return {
    approved: false,
    reason: "inconclusive_answers",
    summary,
  };
}

function buildSupportMessage(input) {
  const parts = ["Solicitação automática sem acesso ao e-mail (cláusula 1.4)."];
  parts.push(
    `Locais informados no questionário: ${input.submittedPlaces.length}.`,
  );
  if (input.activityLocality) {
    parts.push(`Cidade informada: ${input.activityLocality}.`);
  }
  if (input.createdMonth) {
    parts.push(`Mês de cadastro informado: ${input.createdMonth}.`);
  }
  if (input.notes) {
    parts.push(`Observações do solicitante: ${input.notes}`);
  }
  return parts.join("\n");
}

async function submit(rawInput, { ip = null } = {}) {
  const input = parseInput(rawInput);
  const targetKey = normalizeComparable(input.accountIdentifier);

  try {
    await rateLimit.check({
      identifier: `account-recovery:target:${targetKey}`,
      limit: TARGET_RATE_LIMIT,
      windowMs: TARGET_RATE_WINDOW_MS,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const targetUser = await findAccountByIdentifier(input.accountIdentifier);
      await auditLog.record({
        action: "account_recovery.rate_limited",
        targetUserId: targetUser?.id || null,
        ip,
        metadata: { reason: "abuse_rate_limit" },
      });
      await supportRequest.createRecoveryEscalation({
        userId: targetUser?.id || null,
        contactEmail: input.newEmail,
        accountIdentifier: input.accountIdentifier,
        subject: "Recuperação sem acesso ao e-mail (limite atingido)",
        message: buildSupportMessage(input),
        metadata: {
          source: "recovery_without_email",
          reason: "abuse_rate_limit",
          has_private_history: null,
          old_email_matched: false,
          places_matched_count: 0,
          reinforcement_matched: false,
          submitted_places_count: input.submittedPlaces.length,
        },
      });
    }
    throw error;
  }

  const targetUser = await findAccountByIdentifier(input.accountIdentifier);
  const signals = targetUser
    ? await loadPrivateSignals(targetUser.id)
    : { privatePlaceNames: [], localities: new Set() };

  const evaluation = evaluateOwnership(targetUser, signals, input);

  if (evaluation.approved && targetUser) {
    try {
      await emailChange.requestChange({
        targetUser,
        newEmail: input.newEmail,
      });

      await auditLog.record({
        action: "account_recovery.auto_approved",
        targetUserId: targetUser.id,
        ip,
        metadata: {
          reason: evaluation.reason,
          places_matched_count: evaluation.summary.places_matched_count,
          reinforcement_matched: evaluation.summary.reinforcement_matched,
        },
      });

      return UNIFORM_RESPONSE;
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }

      // Se o novo e-mail já estiver em uso ou igual ao atual, nunca vaza
      // enumeração na resposta; encaminha com segurança para triagem manual.
      evaluation.approved = false;
      evaluation.reason = "new_email_unavailable";
    }
  }

  await supportRequest.createRecoveryEscalation({
    userId: targetUser?.id || null,
    contactEmail: input.newEmail,
    accountIdentifier: input.accountIdentifier,
    subject: "Recuperação sem acesso ao e-mail",
    message: buildSupportMessage(input),
    metadata: {
      source: "recovery_without_email",
      reason: evaluation.reason,
      has_private_history: evaluation.summary.has_private_history,
      old_email_matched: evaluation.summary.old_email_matched,
      places_matched_count: evaluation.summary.places_matched_count,
      reinforcement_matched: evaluation.summary.reinforcement_matched,
      submitted_places_count: input.submittedPlaces.length,
    },
  });

  await auditLog.record({
    action: "account_recovery.escalated",
    targetUserId: targetUser?.id || null,
    ip,
    metadata: {
      reason: evaluation.reason,
      has_private_history: evaluation.summary.has_private_history,
      places_matched_count: evaluation.summary.places_matched_count,
    },
  });

  return UNIFORM_RESPONSE;
}

const accountRecovery = {
  UNIFORM_RESPONSE,
  getQuestions,
  parseInput,
  evaluateOwnership,
  submit,
};

export default accountRecovery;
