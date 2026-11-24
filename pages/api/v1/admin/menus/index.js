import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import menuAdmin from "models/menuAdmin.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("manage:menu"),
    getHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const result = await menuAdmin.listWithMenus(request.query);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(result);
}
