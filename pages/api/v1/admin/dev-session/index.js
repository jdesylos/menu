import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import session from "models/session.js";
import authorization from "models/authorization.js";
import auditLog from "models/auditLog.js";
import { NotFoundError } from "infra/errors.js";
import { ensureDevAdmin } from "infra/scripts/seed-dev-admin.mjs";

// Facilidade exclusiva de desenvolvimento para autenticar a credencial admin de
// testes no painel. Em produção responde 404.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .post(postHandler)
  .handler(controller.errorHandlers);

async function postHandler(request, response) {
  if (process.env.NODE_ENV === "production") {
    throw new NotFoundError({
      message: "Recurso não encontrado.",
      action: "Use /admin/login com suas credenciais administrativas.",
    });
  }

  const adminUser = await ensureDevAdmin();
  const newSession = await session.create(adminUser.id, {
    expirationMs: session.ADMIN_EXPIRATION_IN_MILLISECONDS,
  });

  controller.setSessionCookie(newSession.token, response, {
    maxAgeSeconds: session.ADMIN_EXPIRATION_IN_MILLISECONDS / 1000,
  });

  await auditLog.record({
    action: "admin.dev_session.created",
    actorUserId: adminUser.id,
    ip: controller.getClientIp(request),
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(201).json({
    user: authorization.filterOutput(adminUser, "read:user:self", adminUser),
  });
}
