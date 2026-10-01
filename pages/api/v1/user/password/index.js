import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import user from "models/user.js";
import auditLog from "models/auditLog.js";
import { ValidationError } from "infra/errors.js";

// A senha de quem está com a sessão: trocar.
//
// Mora em `/user`, como apagar a conta, e pelo mesmo motivo: quem é a conta
// sai da sessão, e não do endereço. E pede a senha atual — ver
// `user.changePassword`.
//
// O limite é o do login, e pelo mesmo motivo: com uma sessão na mão, esta rota
// também responde se uma senha confere.
export default createRouter()
  .use(controller.injectAnonymousOrUser)
  .patch(
    controller.rateLimit({
      key: "password",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    controller.canRequest("update:user"),
    patchHandler,
  )
  .handler(controller.errorHandlers);

async function patchHandler(request, response) {
  const userTryingToPatch = request.context.user;
  const ip = controller.getClientIp(request);
  const input = request.body || {};

  let changed;
  try {
    changed = await user.changePassword({
      userId: userTryingToPatch.id,
      currentPassword: input.current_password,
      newPassword: input.password,
      sessionToken: request.cookies.session_id,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      await auditLog.record({
        action: "user.password_change_failed",
        actorUserId: userTryingToPatch.id,
        ip,
      });
    }
    throw error;
  }

  await auditLog.record({
    action: "user.password_changed",
    actorUserId: userTryingToPatch.id,
    ip,
  });

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  return response.status(200).json({ updated_at: changed.updated_at });
}
