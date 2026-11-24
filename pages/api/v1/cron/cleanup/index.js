import crypto from "node:crypto";
import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import database from "infra/database.js";
import { UnauthorizedError } from "infra/errors.js";

// Limpeza periódica de registros temporários vencidos (`rate_limits`, sessões e
// tokens de ativação/recuperação). Executado pelo Vercel Cron com `CRON_SECRET`.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .get(getHandler)
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  authorizeCronRequest(request);

  const result = await database.query(`
    WITH deleted_rate_limits AS (
      DELETE FROM rate_limits
      WHERE window_started_at < NOW() - interval '24 hours'
      RETURNING 1
    ),
    deleted_sessions AS (
      DELETE FROM sessions
      WHERE expires_at < NOW() - interval '7 days'
      RETURNING 1
    ),
    deleted_activation_tokens AS (
      DELETE FROM user_activation_tokens
      WHERE expires_at < NOW() - interval '7 days'
      RETURNING 1
    ),
    deleted_recovery_tokens AS (
      DELETE FROM password_recovery_tokens
      WHERE expires_at < NOW() - interval '7 days'
      RETURNING 1
    ),
    deleted_email_change_tokens AS (
      DELETE FROM user_email_change_tokens
      WHERE expires_at < NOW() - interval '7 days'
      RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM deleted_rate_limits) AS rate_limits,
      (SELECT count(*)::int FROM deleted_sessions) AS sessions,
      (SELECT count(*)::int FROM deleted_activation_tokens) AS activation_tokens,
      (SELECT count(*)::int FROM deleted_recovery_tokens) AS recovery_tokens,
      (SELECT count(*)::int FROM deleted_email_change_tokens) AS email_change_tokens
  ;`);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    deleted: result.rows[0],
  });
}

function authorizeCronRequest(request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers?.authorization;

  if (!secret || typeof header !== "string") {
    throw unauthorizedCron();
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);

  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    throw unauthorizedCron();
  }
}

function unauthorizedCron() {
  return new UnauthorizedError({
    message: "Não autorizado a executar a limpeza agendada.",
    action: "Informe o cabeçalho Authorization com o CRON_SECRET válido.",
  });
}
