import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import menu from "models/menu.js";
import menuAdmin from "models/menuAdmin.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("manage:menu"),
    getHandler,
  )
  .put(
    controller.canRequest("admin"),
    controller.canRequest("manage:menu"),
    putHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const result = await menuAdmin.findPlaceMenus(request.query.place_id);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(result);
}

async function putHandler(request, response) {
  const actor = request.context.user;
  const body =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? request.body
      : {};

  const saved = await menu.saveByAdmin(actor, {
    ...body,
    place_id: request.query.place_id,
  });

  await auditLog.record({
    action: "admin.menu.saved",
    actorUserId: actor.id,
    ip: controller.getClientIp(request),
    metadata: {
      place_id: saved.place_id,
      menu_id: saved.id,
      replaces_menu_id: saved.replaces_menu_id,
    },
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(saved);
}
