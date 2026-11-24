import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";
import supportRequest from "models/supportRequest.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .patch(
    controller.canRequest("admin"),
    controller.canRequest("manage:support"),
    patchHandler,
  )
  .handler(controller.errorHandlers);

async function patchHandler(request, response) {
  const actor = request.context.user;
  const { previous, updated } = await supportRequest.updateByAdmin(
    actor,
    request.query.id,
    request.body ?? {},
  );

  await auditLog.record({
    action: "admin.support_request.updated",
    actorUserId: actor.id,
    targetUserId: updated.user_id || null,
    ip: controller.getClientIp(request),
    metadata: {
      request_id: updated.id,
      category: updated.category,
      from_status: previous.status,
      to_status: updated.status,
      resolved_place_id: updated.resolved_place_id,
    },
  });

  response.setHeader("Cache-Control", "no-store");
  return response
    .status(200)
    .json(authorization.filterOutput(actor, "read:support_request", updated));
}
