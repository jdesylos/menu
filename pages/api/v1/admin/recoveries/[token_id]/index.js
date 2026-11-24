import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";
import recovery from "models/recovery.js";
import user from "models/user.js";
import { ForbiddenError } from "infra/errors.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .get(getHandler)
  .patch(
    controller.rateLimit({
      key: "admin-recovery-reset",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    patchHandler,
  )
  .handler(controller.errorHandlers);

async function ensureAdminToken(tokenId) {
  const token = await recovery.findOneValidById(tokenId);
  const owner = await user.findOneById(token.user_id);

  if (owner.deleted_at || !authorization.can(owner, "admin")) {
    throw new ForbiddenError({
      message: "Este link não pertence a uma conta administrativa.",
      action: "Use o aplicativo Menu Spoiler para recuperar contas comuns.",
    });
  }

  return token;
}

async function getHandler(request, response) {
  const token = await ensureAdminToken(request.query.token_id);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    id: token.id,
    expires_at: token.expires_at,
  });
}

async function patchHandler(request, response) {
  const tokenId = request.query.token_id;
  await ensureAdminToken(tokenId);

  const newPassword =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? request.body.password
      : undefined;

  const result = await recovery.reset(tokenId, newPassword);

  await auditLog.record({
    action: "admin.recovery.completed",
    actorUserId: result.user_id,
    targetUserId: result.user_id,
    ip: controller.getClientIp(request),
  });

  controller.clearSessionCookie(response);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ used_at: result.used_at });
}
