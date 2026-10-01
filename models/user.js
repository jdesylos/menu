import database from "infra/database.js";
import password from "models/password.js";
import { ValidationError, NotFoundError } from "infra/errors.js";

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
  await validateUniqueUsername(userInputValues.username);
  await validateUniqueEmail(userInputValues.email);
  await hashPasswordInObject(userInputValues);
  injectDefaultFeaturesInObject(userInputValues);

  const newUser = await runInsertQuery(userInputValues);
  return newUser;

  async function runInsertQuery(userInputValues) {
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
  }

  function injectDefaultFeaturesInObject(userInputValues) {
    userInputValues.features = ["read:activation_token"];
  }
}

async function update(username, userInputValues) {
  const currentUser = await findOneByUsername(username);

  if ("username" in userInputValues) {
    await validateUniqueUsername(userInputValues.username);
  }

  if ("email" in userInputValues) {
    await validateUniqueEmail(userInputValues.email);
  }

  if ("password" in userInputValues) {
    await hashPasswordInObject(userInputValues);
  }

  const userWithNewValues = { ...currentUser, ...userInputValues };

  const updatedUser = await runUpdateQuery(userWithNewValues);
  return updatedUser;

  async function runUpdateQuery(userWithNewValues) {
    const results = await database.query({
      text: `
        UPDATE
          users
        SET
          username = $2,
          email = $3,
          password = $4,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
        RETURNING
          *
      `,
      values: [
        userWithNewValues.id,
        userWithNewValues.username,
        userWithNewValues.email,
        userWithNewValues.password,
      ],
    });

    return results.rows[0];
  }
}

async function validateUniqueUsername(username) {
  const results = await database.query({
    text: `
      SELECT
        username
      FROM
        users
      WHERE
        LOWER(username) = LOWER($1)
      ;`,
    values: [username],
  });

  if (results.rowCount > 0) {
    throw new ValidationError({
      message: "O username informado já está sendo utilizado.",
      action: "Utilize outro username para realizar esta operação.",
    });
  }
}

async function validateUniqueEmail(email) {
  const results = await database.query({
    text: `
      SELECT
        email
      FROM
        users
      WHERE
        LOWER(email) = LOWER($1)
      ;`,
    values: [email],
  });

  if (results.rowCount > 0) {
    throw new ValidationError({
      message: "O email informado já está sendo utilizado.",
      action: "Utilize outro email para realizar esta operação.",
    });
  }
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

const user = {
  create,
  findOneById,
  findOneByUsername,
  findOneByEmail,
  update,
  setFeatures,
  addFeatures,
  changePassword,
  validateNewPassword,
  erase,
};

export default user;
