import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import database from "infra/database.js";
import auditLog from "models/auditLog.js";
import menuAdmin from "models/menuAdmin.js";
import place from "models/place.js";
import { ValidationError } from "infra/errors.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("manage:place"),
    getHandler,
  )
  .patch(
    controller.canRequest("admin"),
    controller.canRequest("manage:place"),
    patchHandler,
  )
  .delete(
    controller.canRequest("admin"),
    controller.canRequest("manage:place"),
    deleteHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const {
    place: found,
    latest_menu,
    history,
  } = await menuAdmin.findPlaceMenus(request.query.id);

  const suggestionsResult = await database.query({
    text: `
      SELECT
        id, kind, status, changes, created_at, reviewed_at
      FROM
        place_suggestions
      WHERE
        place_id = $1 OR duplicate_of = $1
      ORDER BY
        created_at DESC
      LIMIT 20
    ;`,
    values: [found.id],
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    place: found,
    latest_menu,
    menu_history: history,
    suggestions: suggestionsResult.rows,
  });
}

async function patchHandler(request, response) {
  const actor = request.context.user;
  const placeId = request.query.id;
  const body =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? request.body
      : {};
  const ip = controller.getClientIp(request);

  if (body.action === "hide") {
    const hidden = await place.hideByAdmin(placeId, {
      reason: body.reason || "admin_removed",
      duplicateOf: body.duplicate_of || null,
    });
    await auditLog.record({
      action: "admin.place.hidden",
      actorUserId: actor.id,
      ip,
      metadata: {
        place_id: hidden.id,
        reason: hidden.hidden_reason,
        duplicate_of: hidden.duplicate_of,
      },
    });
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(hidden);
  }

  if (body.action === "restore") {
    const restored = await place.restoreByAdmin(placeId);
    await auditLog.record({
      action: "admin.place.restored",
      actorUserId: actor.id,
      ip,
      metadata: { place_id: restored.id },
    });
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(restored);
  }

  if (body.action !== undefined) {
    throw new ValidationError({
      message: `A ação "${body.action}" não existe.`,
      action: 'Use "hide", "restore" ou envie os campos para editar.',
    });
  }

  const updated = await place.updateByAdmin(placeId, body);
  await auditLog.record({
    action: "admin.place.updated",
    actorUserId: actor.id,
    ip,
    metadata: {
      place_id: updated.id,
      changed_fields: Object.keys(body),
    },
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(updated);
}

async function deleteHandler(request, response) {
  const actor = request.context.user;
  const deleted = await place.erasePhysicalByAdmin(request.query.id);

  await auditLog.record({
    action: "admin.place.deleted",
    actorUserId: actor.id,
    ip: controller.getClientIp(request),
    metadata: { place_id: deleted.id, name: deleted.name },
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(deleted);
}
