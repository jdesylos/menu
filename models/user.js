import database from "infra/database.js";
import password from "models/password.js";
import authorization from "models/authorization.js";
import auditLog from "models/auditLog.js";
import { ValidationError, NotFoundError } from "infra/errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ADMIN_LIST_MAX = 50;

async function findOneById(id) {
  const userFound = await runSelectQuery(id);

  return userFound;

  async function runSelectQuery(id) {
    const results = await database.query({
      text: `
        SELECT
          *
        FROM
          users
        WHERE
          id = $1
        LIMIT
          1
        ;`,
      values: [id],
    });

    if (results.rowCount === 0) {
      throw new NotFoundError({
        message: "O id informado não foi encontrado no sistema.",
        action: "Verifique se o id está digitado corretamente.",
      });
    }

    return results.rows[0];
  }
}

async function findOneByUsername(username) {
  const userFound = await runSelectQuery(username);

  return userFound;

  async function runSelectQuery(username) {
    const results = await database.query({
      text: `
        SELECT
          *
        FROM
          users
        WHERE
          LOWER(username) = LOWER($1)
        LIMIT
          1
        ;`,
      values: [username],
    });

    if (results.rowCount === 0) {
      throw new NotFoundError({
        message: "O username informado não foi encontrado no sistema.",
        action: "Verifique se o username está digitado corretamente.",
      });
    }

    return results.rows[0];
  }
}

async function findOneByEmail(email) {
  const userFound = await runSelectQuery(email);

  return userFound;

  async function runSelectQuery(email) {
    const results = await database.query({
      text: `
        SELECT
          *
        FROM
          users
        WHERE
          LOWER(email) = LOWER($1)
        LIMIT
          1
        ;`,
      values: [email],
    });

    if (results.rowCount === 0) {
      throw new NotFoundError({
        message: "O email informado não foi encontrado no sistema.",
        action: "Verifique se o email está digitado corretamente.",
      });
    }

    return results.rows[0];
  }
}

async function create(userInputValues) {
  validateCreateInput(userInputValues);
  await validateUniqueUsernameAndEmail(
    userInputValues.username,
    userInputValues.email,
  );
  await hashPasswordInObject(userInputValues);
  injectDefaultFeaturesInObject(userInputValues);

  const newUser = await runInsertQuery(userInputValues);
  return newUser;

  async function runInsertQuery(userInputValues) {
    try {
      const results = await database.query({
        text: `
          INSERT INTO
            users (username, email, password, features)
          VALUES
            ($1, $2, $3, $4)
          RETURNING
            *
          ;`,
        values: [
          userInputValues.username,
          userInputValues.email,
          userInputValues.password,
          userInputValues.features,
        ],
      });
      return results.rows[0];
    } catch (error) {
      if (error.cause?.code === "23505") {
        const constraint = error.cause?.constraint || "";
        if (constraint.includes("username")) {
          throw usernameTakenError();
        }
        if (constraint.includes("email")) {
          throw emailTakenError();
        }
      }
      throw error;
    }
  }

  function injectDefaultFeaturesInObject(userInputValues) {
    userInputValues.features = ["read:activation_token"];
  }
}

function validateCreateInput(userInputValues) {
  if (
    typeof userInputValues?.username !== "string" ||
    userInputValues.username.trim().length === 0
  ) {
    throw new ValidationError({
      message: "O username não foi informado.",
      action: "Informe um username para realizar o cadastro.",
    });
  }

  if (
    typeof userInputValues?.email !== "string" ||
    userInputValues.email.trim().length === 0
  ) {
    throw new ValidationError({
      message: "O email não foi informado.",
      action: "Informe um email para realizar o cadastro.",
    });
  }

  if (
    typeof userInputValues?.password !== "string" ||
    userInputValues.password.length === 0
  ) {
    throw new ValidationError({
      message: "A senha não foi informada.",
      action: "Informe uma senha para realizar o cadastro.",
    });
  }
}

async function validateUniqueUsernameAndEmail(username, email) {
  const results = await database.query({
    text: `
      SELECT
        EXISTS (
          SELECT
            1
          FROM
            users
          WHERE
            LOWER(username) = LOWER($1)
        ) AS username_taken,
        EXISTS (
          SELECT
            1
          FROM
            users
          WHERE
            LOWER(email) = LOWER($2)
        ) AS email_taken
    ;`,
    values: [username, email],
  });

  if (results.rows[0].username_taken) {
    throw usernameTakenError();
  }

  if (results.rows[0].email_taken) {
    throw emailTakenError();
  }
}

// `exceptUserId` é a conta que está trocando o próprio nome: sem deixá-la de
// fora, mudar só as maiúsculas ("ana" para "Ana") esbarraria nela mesma.
async function validateUniqueUsername(username, exceptUserId = null) {
  const results = await database.query({
    text: `
      SELECT
        username
      FROM
        users
      WHERE
        LOWER(username) = LOWER($1)
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      ;`,
    values: [username, exceptUserId],
  });

  if (results.rowCount > 0) {
    throw usernameTakenError();
  }
}

function usernameTakenError() {
  return new ValidationError({
    message: "O username informado já está sendo utilizado.",
    action: "Utilize outro username para realizar esta operação.",
  });
}

function emailTakenError() {
  return new ValidationError({
    message: "O email informado já está sendo utilizado.",
    action: "Utilize outro email para realizar esta operação.",
  });
}

async function hashPasswordInObject(userInputValues) {
  const hashedPassword = await password.hash(userInputValues.password);
  userInputValues.password = hashedPassword;
}

async function setFeatures(userId, features) {
  const updatedUser = await runUpdateQuery(userId, features);
  return updatedUser;

  async function runUpdateQuery(userId, features) {
    const results = await database.query({
      text: `
       UPDATE
         users
       SET
         features = $2,
         updated_at = timezone('utc', now())
       WHERE
         id = $1
       RETURNING
         *
       ;`,
      values: [userId, features],
    });

    return results.rows[0];
  }
}

async function addFeatures(userId, features) {
  const updatedUser = await runUpdateQuery(userId, features);
  return updatedUser;

  async function runUpdateQuery(userId, features) {
    const results = await database.query({
      text: `
       UPDATE
         users
       SET
         features = array_cat(features, $2),
         updated_at = timezone('utc', now())
       WHERE
         id = $1
       RETURNING
         *
       ;`,
      values: [userId, features],
    });

    return results.rows[0];
  }
}

// Apaga a conta: esvazia a linha, e leva junto o que só existia por causa dela.
//
// O porquê de esvaziar em vez de remover está na migration
// "add-deleted-at-to-users". Em resumo: os cardápios e as sugestões que a
// conta mandou continuam apontando para ela, e continuam valendo.
//
// O que some, numa instrução só — conta apagada pela metade não existe:
//
// - nome de usuário, email e senha, que viram nulos (e ficam livres para
//   outra pessoa usar);
// - as features: a conta não pode mais nada;
// - as sessões, apagadas — o aparelho que ainda guarda um token recebe 401;
// - os links de ativação, e os de recuperação de senha;
// - o IP dos registros de auditoria dela: o registro do que aconteceu fica,
//   sem o endereço de onde veio.
//
// O que fica: o id, as datas, e o que ela mandou para o mapa.
async function erase(userId) {
  const results = await database.query({
    text: `
      WITH erased AS (
        UPDATE
          users
        SET
          username = NULL,
          email = NULL,
          password = NULL,
          features = '{}',
          deleted_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          id = $1
          AND deleted_at IS NULL
        RETURNING
          id,
          deleted_at
      ),
      removed_sessions AS (
        DELETE FROM
          sessions
        WHERE
          user_id IN (SELECT id FROM erased)
      ),
      removed_activation_tokens AS (
        DELETE FROM
          user_activation_tokens
        WHERE
          user_id IN (SELECT id FROM erased)
      ),
      removed_recovery_tokens AS (
        DELETE FROM
          password_recovery_tokens
        WHERE
          user_id IN (SELECT id FROM erased)
      ),
      removed_email_change_tokens AS (
        DELETE FROM
          user_email_change_tokens
        WHERE
          user_id IN (SELECT id FROM erased)
      ),
      anonymized_audit_logs AS (
        UPDATE
          audit_logs
        SET
          ip = NULL
        WHERE
          actor_user_id IN (SELECT id FROM erased)
          OR target_user_id IN (SELECT id FROM erased)
      )
      SELECT
        id,
        deleted_at
      FROM
        erased
    ;`,
    values: [userId],
  });

  if (results.rowCount === 0) {
    throw new NotFoundError({
      message: "A conta informada não foi encontrada.",
      action: "Entre de novo e tente apagar a conta outra vez.",
    });
  }

  return results.rows[0];
}

// A senha de 8 a 72: o piso é o do padrão do repositório judhagsan, e o teto
// é o do bcrypt, que ignora o que passar de 72 BYTES — aceitar mais seria
// guardar uma senha diferente da que a pessoa digitou.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

function validateNewPassword(newPassword) {
  if (
    typeof newPassword !== "string" ||
    newPassword.length < PASSWORD_MIN_LENGTH ||
    Buffer.byteLength(newPassword, "utf8") > PASSWORD_MAX_BYTES
  ) {
    throw new ValidationError({
      message: "A senha nova não é válida.",
      action: `Escolha uma senha de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_BYTES} caracteres.`,
    });
  }
}

// Troca a senha de quem a conhece.
//
// Pede a senha ATUAL, e não só a sessão: quem pega um aparelho desbloqueado
// tem a sessão, e sem esta conferência trocaria a senha e ficaria com a conta.
// É o que separa esta troca da de `update`, que serve a quem administra.
//
// As OUTRAS sessões da conta morrem junto, na mesma instrução: quem troca a
// senha porque desconfia de alguém quer esse alguém fora. A sessão que pediu
// continua — derrubá-la obrigaria a digitar de novo a senha que acabou de ser
// digitada duas vezes. E os links de "esqueci a senha" que estivessem
// pendentes deixam de valer: quem acabou de escolher a senha não esqueceu, e
// um link desses solto num email ainda trocaria a senha de novo.
async function changePassword({
  userId,
  currentPassword,
  newPassword,
  sessionToken,
}) {
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new ValidationError({
      message: "A senha atual não foi informada.",
      action: "Digite a sua senha atual e tente de novo.",
    });
  }

  validateNewPassword(newPassword);

  const currentUser = await findOneById(userId);

  // 400, e não 401: para o aplicativo, 401 é sessão morta — ele esqueceria a
  // conta de quem só errou uma letra.
  const matches = await password.compare(currentPassword, currentUser.password);
  if (!matches) {
    throw new ValidationError({
      message: "A senha atual não confere.",
      action: "Confira a senha atual e tente de novo.",
    });
  }

  if (currentPassword === newPassword) {
    throw new ValidationError({
      message: "A senha nova é igual à atual.",
      action: "Escolha uma senha diferente da atual.",
    });
  }

  const hashedPassword = await password.hash(newPassword);

  const results = await database.query({
    text: `
      WITH changed AS (
        UPDATE
          users
        SET
          password = $2,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
          AND deleted_at IS NULL
        RETURNING
          id,
          updated_at
      ),
      expired_sessions AS (
        UPDATE
          sessions
        SET
          expires_at = expires_at - interval '1 year',
          updated_at = NOW()
        WHERE
          user_id IN (SELECT id FROM changed)
          AND token <> $3
          AND expires_at > NOW()
      ),
      spent_recovery_tokens AS (
        UPDATE
          password_recovery_tokens
        SET
          used_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          user_id IN (SELECT id FROM changed)
          AND used_at IS NULL
      )
      SELECT
        id,
        updated_at
      FROM
        changed
    ;`,
    values: [userId, hashedPassword, sessionToken],
  });

  if (results.rowCount === 0) {
    throw new NotFoundError({
      message: "A conta informada não foi encontrada.",
      action: "Entre de novo e tente trocar a senha outra vez.",
    });
  }

  return results.rows[0];
}

// O teto da coluna (`varchar(30)`), contado em caracteres, como o Postgres
// conta — e não em bytes.
const USERNAME_MAX_LENGTH = 30;

// Troca o nome de quem está com a sessão.
//
// O nome chega sem os espaços das pontas, com 1 a 30 caracteres, e não pode
// ser o de outra conta — sem distinguir maiúsculas, como no cadastro. Mudar
// só as maiúsculas do próprio nome vale.
//
// Não pede a senha, ao contrário da troca de senha: o nome não abre a conta,
// e quem está com a sessão já pode fazer o que ele faria com ela.
async function changeUsername({ userId, newUsername, currentUser = null }) {
  if (typeof newUsername !== "string" || newUsername.trim().length === 0) {
    throw new ValidationError({
      message: "O nome de usuário não foi informado.",
      action: "Escolha um nome de usuário e tente de novo.",
    });
  }

  const username = newUsername.trim();
  if ([...username].length > USERNAME_MAX_LENGTH) {
    throw new ValidationError({
      message: `O nome de usuário passa de ${USERNAME_MAX_LENGTH} caracteres.`,
      action: `Escolha um nome com até ${USERNAME_MAX_LENGTH} caracteres.`,
    });
  }

  if (currentUser) {
    if (currentUser.username === username) {
      throw new ValidationError({
        message: "O nome de usuário novo é igual ao atual.",
        action: "Escolha um nome diferente do atual.",
      });
    }
    await validateUniqueUsername(username, userId);
  } else {
    const [storedUser] = await Promise.all([
      findOneById(userId),
      validateUniqueUsername(username, userId),
    ]);
    if (storedUser.username === username) {
      throw new ValidationError({
        message: "O nome de usuário novo é igual ao atual.",
        action: "Escolha um nome diferente do atual.",
      });
    }
  }

  let results;
  try {
    results = await database.query({
      text: `
        UPDATE
          users
        SET
          username = $2,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
          AND deleted_at IS NULL
        RETURNING
          *
      ;`,
      values: [userId, username],
    });
  } catch (error) {
    // Duas contas pedindo o mesmo nome ao mesmo tempo passam as duas pela
    // conferência acima, e quem separa a que chegou primeiro é o `unique` da
    // coluna. A segunda ouve o mesmo que ouviria um segundo depois.
    if (error.cause?.code === "23505") {
      throw usernameTakenError();
    }
    throw error;
  }

  if (results.rowCount === 0) {
    throw new NotFoundError({
      message: "A conta informada não foi encontrada.",
      action: "Entre de novo e tente trocar o nome outra vez.",
    });
  }

  return results.rows[0];
}

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function normalizeAndValidateEmail(rawEmail) {
  if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
    throw new ValidationError({
      message: "O email não foi informado.",
      action: "Informe um email válido e tente de novo.",
    });
  }

  const normalized = rawEmail.trim();
  if (normalized.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    throw new ValidationError({
      message: "O email informado não é válido.",
      action: "Confira o endereço de email e tente de novo.",
    });
  }

  return normalized;
}

async function validateUniqueEmail(email, exceptUserId = null) {
  const results = await database.query({
    text: `
      SELECT
        id
      FROM
        users
      WHERE
        LOWER(email) = LOWER($1)
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT
        1
    ;`,
    values: [email, exceptUserId],
  });

  if (results.rowCount > 0) {
    throw emailTakenError();
  }
}

function normalizePagination(query) {
  const rawPage = Number.parseInt(query?.page ?? "1", 10);
  const rawLimit = Number.parseInt(query?.limit ?? "25", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), USER_ADMIN_LIST_MAX)
    : 25;
  return { page, limit, offset: (page - 1) * limit };
}

async function listForAdmin(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const filter = ["all", "active", "pending", "admin", "deleted"].includes(
    query.filter,
  )
    ? query.filter
    : "all";
  const { page, limit, offset } = normalizePagination(query);

  const conditions = [];
  const values = [];

  if (filter === "active") {
    conditions.push(
      "users.deleted_at IS NULL AND 'create:session' = ANY(users.features)",
    );
  } else if (filter === "pending") {
    conditions.push(
      "users.deleted_at IS NULL AND 'read:activation_token' = ANY(users.features)",
    );
  } else if (filter === "admin") {
    conditions.push(
      "users.deleted_at IS NULL AND 'admin' = ANY(users.features)",
    );
  } else if (filter === "deleted") {
    conditions.push("users.deleted_at IS NOT NULL");
  }

  if (q.length > 0) {
    values.push(`%${escapeLike(q)}%`);
    const likeParam = `$${values.length}`;
    if (UUID_PATTERN.test(q)) {
      values.push(q);
      const idParam = `$${values.length}`;
      conditions.push(
        `(users.id = ${idParam}::uuid OR LOWER(users.username) LIKE LOWER(${likeParam}) ESCAPE '\\' OR LOWER(users.email) LIKE LOWER(${likeParam}) ESCAPE '\\')`,
      );
    } else {
      conditions.push(
        `(LOWER(users.username) LIKE LOWER(${likeParam}) ESCAPE '\\' OR LOWER(users.email) LIKE LOWER(${likeParam}) ESCAPE '\\')`,
      );
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await database.query({
    text: `SELECT count(*)::int AS total FROM users ${whereClause};`,
    values,
  });

  const rowsResult = await database.query({
    text: `
      SELECT
        users.id,
        users.username,
        users.email,
        users.features,
        users.created_at,
        users.updated_at,
        users.deleted_at,
        (SELECT count(*)::int FROM menus WHERE menus.created_by = users.id) AS menus_count,
        (SELECT count(*)::int FROM place_suggestions WHERE place_suggestions.created_by = users.id) AS suggestions_count
      FROM
        users
      ${whereClause}
      ORDER BY
        users.created_at DESC,
        users.id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    ;`,
    values: [...values, limit, offset],
  });

  return {
    items: rowsResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

async function findAdminDetailById(userId) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    throw new NotFoundError({
      message: "O id informado não foi encontrado no sistema.",
      action: "Verifique se o id está digitado corretamente.",
    });
  }

  const userResult = await database.query({
    text: `
      SELECT
        id,
        username,
        email,
        features,
        created_at,
        updated_at,
        deleted_at
      FROM
        users
      WHERE
        id = $1
      LIMIT
        1
    ;`,
    values: [userId],
  });

  if (userResult.rowCount === 0) {
    throw new NotFoundError({
      message: "O id informado não foi encontrado no sistema.",
      action: "Verifique se o id está digitado corretamente.",
    });
  }

  const target = userResult.rows[0];

  const [menusResult, suggestionsResult, logs, pendingEmailResult] =
    await Promise.all([
      database.query({
        text: `
          SELECT
            menus.id,
            menus.place_id,
            places.name AS place_name,
            menus.currency,
            menus.created_at
          FROM
            menus
            INNER JOIN places ON places.id = menus.place_id
          WHERE
            menus.created_by = $1
          ORDER BY
            menus.created_at DESC
          LIMIT 20
        ;`,
        values: [target.id],
      }),
      database.query({
        text: `
          SELECT
            id,
            kind,
            place_id,
            status,
            changes,
            created_at
          FROM
            place_suggestions
          WHERE
            created_by = $1
          ORDER BY
            created_at DESC
          LIMIT 20
        ;`,
        values: [target.id],
      }),
      auditLog.findByUserId(target.id, { limit: 40 }),
      database.query({
        text: `
          SELECT
            id,
            new_email,
            expires_at,
            created_at
          FROM
            user_email_change_tokens
          WHERE
            user_id = $1
            AND used_at IS NULL
            AND expires_at > NOW()
          ORDER BY
            created_at DESC
          LIMIT 1
        ;`,
        values: [target.id],
      }),
    ]);

  return {
    ...target,
    recent_menus: menusResult.rows,
    recent_suggestions: suggestionsResult.rows,
    audit_logs: logs,
    pending_email_change: pendingEmailResult.rows[0] ?? null,
  };
}

async function updateFeaturesByAdmin(userId, nextFeatures) {
  if (!Array.isArray(nextFeatures)) {
    throw new ValidationError({
      message: "A lista de permissões é inválida.",
      action: "Envie um array válido de features.",
    });
  }

  const deduplicated = [...new Set(nextFeatures)];
  const invalid = deduplicated.filter(
    (feature) => !authorization.availableFeatures.includes(feature),
  );
  if (invalid.length > 0) {
    throw new ValidationError({
      message: `Permissão desconhecida: ${invalid.join(", ")}.`,
      action: "Informe apenas permissões reconhecidas pelo sistema.",
    });
  }

  const results = await database.query({
    text: `
      UPDATE
        users
      SET
        features = $2,
        updated_at = timezone('utc', now())
      WHERE
        id = $1
        AND deleted_at IS NULL
      RETURNING
        id, username, email, features, created_at, updated_at, deleted_at
    ;`,
    values: [userId, deduplicated],
  });

  if (results.rowCount === 0) {
    throw new NotFoundError({
      message: "A conta informada não foi encontrada ou foi excluída.",
      action: "Atualize a listagem de usuários e tente de novo.",
    });
  }

  return results.rows[0];
}

const user = {
  create,
  findOneById,
  findOneByUsername,
  findOneByEmail,
  setFeatures,
  addFeatures,
  updateFeaturesByAdmin,
  changePassword,
  validateNewPassword,
  validateUniqueUsername,
  normalizeAndValidateEmail,
  validateUniqueEmail,
  listForAdmin,
  findAdminDetailById,
  changeUsername,
  erase,
  USERNAME_MAX_LENGTH,
  UUID_PATTERN,
};

export default user;
