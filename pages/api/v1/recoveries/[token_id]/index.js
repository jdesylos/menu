import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import recovery from "models/recovery.js";
import auditLog from "models/auditLog.js";

// O link de recuperação, usado: grava a senha nova de quem o abriu.
//
// Sem sessão: o token do link é a credencial inteira, como o de ativação. O
// limite por IP é folga, e não a tranca — o token é um UUID aleatório, que
// não se adivinha.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .patch(
    controller.rateLimit({
      key: "recovery_use",
      limit: 10,
      windowMs: 15 * 60 * 1000,
    }),
    patchHandler,
  )
  .handler(controller.errorHandlers);

async function patchHandler(request, response) {
  const input = request.body || {};
  const ip = controller.getClientIp(request);

  const spentToken = await recovery.reset(
    request.query.token_id,
    input.password,
  );

  await auditLog.record({
    action: "recovery.used",
    targetUserId: spentToken.user_id,
    ip,
  });

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  // Só quando foi usado: de quem era a conta não sai daqui.
  return response.status(200).json({ used_at: spentToken.used_at });
}
