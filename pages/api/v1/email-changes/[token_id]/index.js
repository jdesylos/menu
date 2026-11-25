import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import emailChange from "models/emailChange.js";
import recovery from "models/recovery.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .get(
    controller.rateLimit({
      key: "email-change-read",
      limit: 20,
      windowMs: 15 * 60 * 1000,
    }),
    getHandler,
  )
  .patch(
    controller.rateLimit({
      key: "email-change-confirm",
      limit: 10,
      windowMs: 15 * 60 * 1000,
    }),
    patchHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const token = await emailChange.findOneValidById(request.query.token_id);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    id: token.id,
    new_email: token.new_email,
    expires_at: token.expires_at,
  });
}

async function patchHandler(request, response) {
  const ip = controller.getClientIp(request);
  const result = await emailChange.confirmByTokenId(request.query.token_id);

  await auditLog.record({
    action: "user.email_changed",
    actorUserId: result.user.id,
    targetUserId: result.user.id,
    ip,
    metadata: { token_id: result.token.id },
  });

  let passwordRecoveryRequested = false;
  if (request.body?.send_password_recovery === true && result.user.email) {
    const recoveryToken = await recovery.request(result.user.email);
    passwordRecoveryRequested = Boolean(recoveryToken);
    await auditLog.record({
      action: "recovery.requested",
      targetUserId: result.user.id,
      ip,
      metadata: { source: "email_change_confirmation" },
    });
  }

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    email: result.user.email,
    updated_at: result.user.updated_at,
    password_recovery_requested: passwordRecoveryRequested,
  });
}
