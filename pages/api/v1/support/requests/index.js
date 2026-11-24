import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";
import supportRequest from "models/supportRequest.js";

const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

// Entrada pública (com ou sem conta autenticada) para "Não encontro o local",
// ajuda geral e ajuda relacionada à conta. Protegida por rate limit por IP.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .post(
    controller.rateLimit({
      key: "support-request",
      limit: 10,
      windowMs: 15 * 60 * 1000,
    }),
    postHandler,
  )
  .get(controller.canRequest("read:session"), getHandler)
  .handler(controller.errorHandlers);

async function postHandler(request, response) {
  const actor = request.context.user;
  const created = await supportRequest.create(actor, request.body ?? {});

  await auditLog.record({
    action: "support.request.created",
    actorUserId: actor?.id || null,
    ip: controller.getClientIp(request),
    metadata: {
      request_id: created.id,
      category: created.category,
    },
  });

  response.setHeader("Cache-Control", NO_STORE);
  return response.status(201).json({
    request: {
      id: created.id,
      category: created.category,
      status: created.status,
      created_at: created.created_at,
    },
  });
}

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const items = await supportRequest.listForUser(userTryingToGet.id);

  response.setHeader("Cache-Control", NO_STORE);
  return response.status(200).json({
    requests: items.map((item) =>
      authorization.filterOutput(userTryingToGet, "read:support_request", item),
    ),
  });
}
