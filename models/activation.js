import authorization from "models/authorization.js";
import { ACTIVATED_FEATURES } from "models/features.js";
import user from "models/user.js";
import email from "infra/email.js";
import database from "infra/database.js";
import webserver from "infra/webserver.js";
import { NotFoundError, ForbiddenError } from "infra/errors.js";

// Um dia, e não quinze minutos: não há reenvio do link, e quem abria o email
// mais tarde ficava com uma conta que nunca entra. O prazo maior não abre
// porta nova — quem lê o email já recupera a senha por ele.
const EXPIRATION_IN_MILLISECONDS = 60 * 60 * 24 * 1000; // 24 hours

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenNotFoundError() {
  return new NotFoundError({
    message:
      "O token de ativação utilizado não foi encontrado no sistema ou expirou.",
    action: "Faça um novo cadastro.",
  });
}

async function findOneValidById(tokenId) {
  if (typeof tokenId !== "string" || !UUID_PATTERN.test(tokenId)) {
    throw tokenNotFoundError();
  }

  const activationTokenObject = await runSelectQuery(tokenId);

  return activationTokenObject;

  async function runSelectQuery(tokenId) {
    const results = await database.query({
      text: `
       SELECT
         *
       FROM
         user_activation_tokens
       WHERE
         id = $1
         AND expires_at > NOW()
         AND used_at IS NULL
       LIMIT
         1
     ;`,
      values: [tokenId],
    });

    if (results.rowCount === 0) {
      throw tokenNotFoundError();
    }

    return results.rows[0];
  }
}

// Consome o token e ativa a conta numa instrução só, evitando corrida entre
// duas chamadas simultâneas ao mesmo link.
async function activateByTokenId(tokenId) {
  if (typeof tokenId !== "string" || !UUID_PATTERN.test(tokenId)) {
    throw tokenNotFoundError();
  }

  const results = await database.query({
    text: `
      WITH valid_token AS (
        SELECT
          id,
          user_id
        FROM
          user_activation_tokens
        WHERE
          id = $1
          AND expires_at > NOW()
          AND used_at IS NULL
        FOR UPDATE
      ),
      activated_user AS (
        UPDATE
          users
        SET
          features = $2,
          updated_at = timezone('utc', now())
        WHERE
          id IN (SELECT user_id FROM valid_token)
          AND 'read:activation_token' = ANY(features)
        RETURNING
          id
      ),
      spent_token AS (
        UPDATE
          user_activation_tokens
        SET
          used_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          id IN (SELECT id FROM valid_token)
          AND user_id IN (SELECT id FROM activated_user)
        RETURNING
          id,
          used_at,
          user_id,
          expires_at,
          created_at,
          updated_at
      )
      SELECT
        spent_token.id,
        spent_token.used_at,
        spent_token.user_id,
        spent_token.expires_at,
        spent_token.created_at,
        spent_token.updated_at
      FROM
        valid_token
        LEFT JOIN spent_token ON spent_token.id = valid_token.id
    ;`,
    values: [tokenId, ACTIVATED_FEATURES],
  });

  if (results.rowCount === 0) {
    throw tokenNotFoundError();
  }

  const row = results.rows[0];
  if (!row.id) {
    throw new ForbiddenError({
      message: "Você não pode mais utilizar tokens de ativação.",
      action: "Entre em contato com o suporte.",
    });
  }

  return row;
}

async function create(userId) {
  const expiresAt = new Date(Date.now() + EXPIRATION_IN_MILLISECONDS);

  const newToken = await runInsertQuery(userId, expiresAt);
  return newToken;

  async function runInsertQuery(userId, expiresAt) {
    const results = await database.query({
      text: `
        INSERT INTO
          user_activation_tokens (user_id, expires_at)
        VALUES
          ($1, $2)
        RETURNING
          *
      ;`,
      values: [userId, expiresAt],
    });

    return results.rows[0];
  }
}

async function markTokenAsUsed(activationTokenId) {
  const usedActivationToken = await runUpdateQuery(activationTokenId);
  return usedActivationToken;

  async function runUpdateQuery(activationTokenId) {
    const results = await database.query({
      text: `
       UPDATE
         user_activation_tokens
       SET
         used_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
       WHERE
         id = $1
       RETURNING
         *
     `,
      values: [activationTokenId],
    });

    return results.rows[0];
  }
}

async function activateUserByUserId(userId) {
  const userToActivate = await user.findOneById(userId);

  if (!authorization.can(userToActivate, "read:activation_token")) {
    throw new ForbiddenError({
      message: "Você não pode mais utilizar tokens de ativação.",
      action: "Entre em contato com o suporte.",
    });
  }

  const activatedUser = await user.setFeatures(userId, ACTIVATED_FEATURES);
  return activatedUser;
}

// Os emails da conta não levam o nome de usuário. Quem cria a conta escolhe o
// nome e o email, e o email pode ser de outra pessoa: com o nome no texto,
// qualquer um faria `contato@menuspoiler.com.br` entregar a um estranho a
// frase que quisesse — "acesse tal site", no primeiro lugar do email,
// assinado pelo nosso domínio.
async function sendEmailToUser(user, activationToken) {
  await email.send({
    from: "Menu Spoiler <contato@menuspoiler.com.br>",
    to: user.email,
    subject: "Ative seu cadastro no Menu Spoiler!",
    text: `Olá! Abra o link abaixo no celular em que o Menu Spoiler está instalado
para ativar seu cadastro. Ele vale por 24 horas.

${webserver.origin}/cadastro/ativar/${activationToken.id}

Se não foi você quem se cadastrou, ignore este email: sem o link, a conta não
é ativada.

Atenciosamente,
Equipe Menu Spoiler`,
  });
}

// Alguém tentou criar uma conta com um email que já tem uma. O cadastro
// responde a essa pessoa o mesmo que a um email novo — ver
// `pages/api/v1/users` —, e quem fica sabendo é o dono do email.
async function sendDuplicateAccountNoticeToUser(existingUser) {
  await email.send({
    from: "Menu Spoiler <contato@menuspoiler.com.br>",
    to: existingUser.email,
    subject: "Tentativa de cadastro com seu email no Menu Spoiler",
    text: `Olá! Alguém tentou criar uma conta nova no Menu Spoiler com este endereço de email.

Se foi você, a sua conta já existe: é só entrar pelo aplicativo. Se esqueceu a
senha, use "Esqueci a senha" na tela de entrar.

Se não foi você, nada muda na sua conta. Se quiser, troque a senha por
precaução.

Atenciosamente,
Equipe Menu Spoiler`,
  });
}

const activation = {
  ACTIVATED_FEATURES,
  findOneValidById,
  activateByTokenId,
  create,
  markTokenAsUsed,
  activateUserByUserId,
  sendEmailToUser,
  sendDuplicateAccountNoticeToUser,
  EXPIRATION_IN_MILLISECONDS,
};

export default activation;
