import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authorization from "models/authorization.js";
import supportRequest from "models/supportRequest.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("manage:support"),
    getHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const actor = request.context.user;
  const result = await supportRequest.listForAdmin(request.query);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    ...result,
    items: result.items.map((item) =>
      authorization.filterOutput(actor, "read:support_request", item),
    ),
  });
}
