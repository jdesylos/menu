import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import session from "models/session.js";
import authorization from "models/authorization.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("read:session"),
    controller.canRequest("admin"),
    getHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const adminUser = request.context.user;
  const activeSession = request.context.session;

  const renewed = await session.renew(activeSession.id, {
    expirationMs: session.ADMIN_EXPIRATION_IN_MILLISECONDS,
  });

  controller.setSessionCookie(renewed.token, response, {
    maxAgeSeconds: session.ADMIN_EXPIRATION_IN_MILLISECONDS / 1000,
  });
  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  return response
    .status(200)
    .json(authorization.filterOutput(adminUser, "read:user:self", adminUser));
}
