import database from "infra/database.js";
import email from "infra/email.js";
import webserver from "infra/webserver.js";
import password from "models/password.js";
import user from "models/user.js";
import { NotFoundError, ValidationError } from "infra/errors.js";

// A recuperação de senha de quem a esqueceu: um link por email, que abre o
// aplicativo na tela de escolher a senha nova.
//
// O link prova uma coisa só — que quem o abriu lê o email da conta —, e é o
// que basta para trocar a senha sem saber a anterior. Por isso ele vale por
// pouco tempo e uma vez só.

const EXPIRATION_IN_MILLISECONDS = 60 * 15 * 1000; // 15 minutes

// O id do token vai direto para uma coluna `uuid`: o que não tem a forma de um
// é recusado aqui, antes de virar erro do banco — e resposta 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenNotFoundError() {
  return new NotFoundError({
    message:
      "O link de recuperação de senha não foi encontrado, já foi usado ou expirou.",
    action: 'Peça um link novo em "Esqueci a senha".',
  });
}

// Pede o link. Devolve o token criado, ou `null` quando não há conta com o
// email — e a rota responde igual nos dois casos, para não revelar quem tem
// conta.
async function request(providedEmail) {
  if (typeof providedEmail !== "string" || providedEmail.trim() === "") {
    throw new ValidationError({
      message: "O email não foi informado.",
      action: "Informe o email da sua conta e tente de novo.",
    });
  }

  let storedUser;
  try {
    // A conta apagada não é achada: o email dela é nulo.
    storedUser = await user.findOneByEmail(providedEmail.trim());
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  }

  const recoveryToken = await create(storedUser.id);
  await sendEmailToUser(storedUser, recoveryToken);

  return recoveryToken;
}

async function create(userId) {
  const expiresAt = new Date(Date.now() + EXPIRATION_IN_MILLISECONDS);

  const results = await database.query({
    text: `
      INSERT INTO
        password_recovery_tokens (user_id, expires_at)
      VALUES
        ($1, $2)
      RETURNING
        *
    ;`,
    values: [userId, expiresAt],
  });

  return results.rows[0];
}

async function findOneValidById(tokenId) {
  if (typeof tokenId !== "string" || !UUID.test(tokenId)) {
    throw tokenNotFoundError();
  }

  const results = await database.query({
    text: `
      SELECT
        *
      FROM
        password_recovery_tokens
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

// O link é o do domínio do aplicativo, e o caminho é o que o filtro dele
// aceita — ver `pages/senha/recuperar/[token].js`.
async function sendEmailToUser(user, recoveryToken) {
  await email.send({
    from: "Menu Spoiler <contato@menuspoiler.com.br>",
    to: user.email,
    subject: "Crie uma senha nova no Menu Spoiler",
    text: `${user.username}, recebemos um pedido para trocar a senha da sua conta no Menu Spoiler.

Para criar uma senha nova, abra este link no celular em que o aplicativo está instalado:

${webserver.origin}/senha/recuperar/${recoveryToken.id}

O link vale por 15 minutos e só pode ser usado uma vez.

Se não foi você quem pediu, ignore este email: a sua senha continua a mesma.

Atenciosamente,
Equipe Menu Spoiler`,
  });
}

// Troca a senha de quem abriu o link.
//
// O link primeiro, e a senha depois: quem chega com um link vencido precisa
// saber disso, e não que a senha que digitou é curta. Com a senha recusada o
// link continua valendo, para a pessoa corrigir e mandar de novo.
//
// Tudo o que a troca faz acontece numa instrução só — senha trocada com o
// link ainda valendo não existe:
//
// - o link é gasto, e os OUTROS links pendentes da conta também;
// - a senha é gravada;
// - TODAS as sessões da conta são encerradas. Aqui não há "a sessão que
//   pediu": quem esqueceu a senha não está dentro, e quem recupera porque
//   perdeu a conta para alguém quer esse alguém fora.
async function reset(tokenId, newPassword) {
  await findOneValidById(tokenId);
  user.validateNewPassword(newPassword);

  const hashedPassword = await password.hash(newPassword);

  const results = await database.query({
    text: `
      WITH spent_token AS (
        UPDATE
          password_recovery_tokens
        SET
          used_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          id = $1
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING
          id,
          user_id,
          used_at
      ),
      changed AS (
        UPDATE
          users
        SET
          password = $2,
          updated_at = timezone('utc', now())
        WHERE
          id IN (SELECT user_id FROM spent_token)
          AND deleted_at IS NULL
        RETURNING
          id
      ),
      other_tokens AS (
        UPDATE
          password_recovery_tokens
        SET
          used_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          user_id IN (SELECT id FROM changed)
          AND id <> $1
          AND used_at IS NULL
      ),
      expired_sessions AS (
        UPDATE
          sessions
        SET
          expires_at = expires_at - interval '1 year',
          updated_at = NOW()
        WHERE
          user_id IN (SELECT id FROM changed)
          AND expires_at > NOW()
      )
      SELECT
        spent_token.id,
        spent_token.user_id,
        spent_token.used_at
      FROM
        spent_token
        INNER JOIN changed ON changed.id = spent_token.user_id
    ;`,
    values: [tokenId, hashedPassword],
  });

  // Outro pedido gastou o link entre a conferência e a troca, ou a conta foi
  // apagada no meio.
  if (results.rowCount === 0) {
    throw tokenNotFoundError();
  }

  return results.rows[0];
}

const recovery = {
  request,
  create,
  findOneValidById,
  sendEmailToUser,
  reset,
  EXPIRATION_IN_MILLISECONDS,
};

export default recovery;
