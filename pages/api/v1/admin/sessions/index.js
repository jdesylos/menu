import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authentication from "models/authentication.js";
import authorization from "models/authorization.js";
import session from "models/session.js";
import auditLog from "models/auditLog.js";
import { ForbiddenError, UnauthorizedError } from "infra/errors.js";

const ADMIN_MAX_AGE_SECONDS = session.ADMIN_EXPIRATION_IN_MILLISECONDS / 1000;

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .post(
    controller.rateLimit({
      key: "admin-login",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    controller.canRequest("create:session"),
    postHandler,
  )
  .delete(deleteHandler)
  .handler(controller.errorHandlers);

async function postHandler(request, response) {
  const input =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? request.body
      : {};
  const ip = controller.getClientIp(request);

  let authenticatedUser;
  try {
    authenticatedUser = await authentication.getUser(
      input.email,
      input.password,
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await auditLog.record({ action: "admin.session.failed", ip });
    }
    throw error;
  }

  if (
    !authorization.can(authenticatedUser, "create:session") ||
    !authorization.can(authenticatedUser, "admin")
  ) {
    await auditLog.record({
      action: "admin.session.forbidden",
      actorUserId: authenticatedUser.id,
      ip,
    });
    throw new ForbiddenError({
      message: "Esta conta não possui acesso ao painel administrativo.",
      action: "Entre com uma conta de administrador autorizada pelo sistema.",
    });
  }

  const newSession = await session.create(authenticatedUser.id, {
    expirationMs: session.ADMIN_EXPIRATION_IN_MILLISECONDS,
  });

  controller.setSessionCookie(newSession.token, response, {
    maxAgeSeconds: ADMIN_MAX_AGE_SECONDS,
  });

  await auditLog.record({
    action: "admin.session.created",
    actorUserId: authenticatedUser.id,
    ip,
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(201).json({
    session: authorization.filterOutput(
      authenticatedUser,
      "read:session",
      newSession,
    ),
    user: authorization.filterOutput(
      authenticatedUser,
      "read:user:self",
      authenticatedUser,
    ),
  });
}

async function deleteHandler(request, response) {
  const actor = request.context.user;
  const activeSession = request.context.session;
  const ip = controller.getClientIp(request);

  if (!activeSession) {
    throw new UnauthorizedError({
      message: "Usuário não possui sessão ativa.",
      action: "Verifique se este usuário está logado e tente novamente.",
    });
  }

  const expired = await session.expireById(activeSession.id);
  controller.clearSessionCookie(response);

  await auditLog.record({
    action: "admin.session.deleted",
    actorUserId: actor.id,
    ip,
  });

  response.setHeader("Cache-Control", "no-store");
  return response
    .status(200)
    .json(authorization.filterOutput(actor, "read:session", expired));
}
