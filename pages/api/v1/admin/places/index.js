import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import place from "models/place.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("manage:place"),
    getHandler,
  )
  .post(
    controller.canRequest("admin"),
    controller.canRequest("manage:place"),
    postHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const vectorTiles = Boolean(process.env.PROTOMAPS_API_KEY);
  const mode = request.query?.mode;

  response.setHeader("Cache-Control", "no-store");

  if (mode === "config") {
    return response.status(200).json({ vector_tiles: vectorTiles });
  }

  if (mode === "viewport") {
    const places = await place.findWithinViewportForAdmin(request.query);
    return response.status(200).json({ places, vector_tiles: vectorTiles });
  }

  const result = await place.searchForAdmin(request.query);
  return response.status(200).json(result);
}

async function postHandler(request, response) {
  const actor = request.context.user;
  const created = await place.createByAdmin(request.body);

  await auditLog.record({
    action: "admin.place.created",
    actorUserId: actor.id,
    ip: controller.getClientIp(request),
    metadata: { place_id: created.id, name: created.name },
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(201).json(created);
}
