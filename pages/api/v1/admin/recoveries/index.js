import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import recovery from "models/recovery.js";

const GENERIC_RESPONSE = {
  message:
    "Se o email informado pertencer a um administrador autorizado, enviamos um link de recuperação.",
};

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .post(
    controller.rateLimit({
      key: "admin-recovery",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    postHandler,
  )
  .handler(controller.errorHandlers);

async function postHandler(request, response) {
  const email =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? request.body.email
      : undefined;

  const token = await recovery.requestAdmin(email);

  await auditLog.record({
    action: "admin.recovery.requested",
    targetUserId: token?.user_id ?? null,
    ip: controller.getClientIp(request),
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(202).json(GENERIC_RESPONSE);
}
