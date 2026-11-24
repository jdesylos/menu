import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import user from "models/user.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("read:user:admin"),
    getHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const result = await user.listForAdmin(request.query);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(result);
}
