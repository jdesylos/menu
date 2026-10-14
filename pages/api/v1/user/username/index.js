import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import user from "models/user.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";

// O nome de usuário de quem está com a sessão: trocar.
//
// Mora em `/user`, como a senha e o apagar, e pelo mesmo motivo: quem é a
// conta sai da sessão, e não do endereço. E o corpo só traz o nome — ver
// `user.changeUsername`.
//
// Com limite, como a senha: cada resposta diz se um nome está em uso, e sem
// teto a rota serviria para levantar a lista de contas.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .patch(
    controller.rateLimit({
      key: "username",
      limit: 10,
      windowMs: 15 * 60 * 1000,
    }),
    controller.canRequest("update:user"),
    patchHandler,
  )
  .handler(controller.errorHandlers);

async function patchHandler(request, response) {
  const userTryingToPatch = request.context.user;
  const input = request.body || {};

  const changed = await user.changeUsername({
    userId: userTryingToPatch.id,
    newUsername: input.username,
  });

  await auditLog.record({
    action: "user.username_changed",
    actorUserId: userTryingToPatch.id,
    ip: controller.getClientIp(request),
  });

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  const secureOutputValues = authorization.filterOutput(
    userTryingToPatch,
    "read:user:self",
    changed,
  );

  return response.status(200).json(secureOutputValues);
}
