import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import user from "models/user.js";
import session from "models/session";
import authorization from "models/authorization.js";

// A conta de quem está com a sessão: ler, e apagar.
//
// Apagar é só da PRÓPRIA conta, e por isso mora aqui, e não em
// `/users/[username]`: quem é a conta sai da sessão, e não do endereço — não
// há como pedir para apagar a de outra pessoa trocando um nome na URL.
export default createRouter()
  .use(controller.injectAnonymousOrUser)
  .get(controller.canRequest("read:session"), getHandler)
  .delete(controller.canRequest("read:session"), deleteHandler)
  .handler(controller.errorHandlers);

const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const sessionToken = request.cookies.session_id;

  const sessionObject = await session.findOneValidByToken(sessionToken);
  const renewedSessionObject = await session.renew(sessionObject.id);
  controller.setSessionCookie(renewedSessionObject.token, response);

  const userFound = await user.findOneById(sessionObject.user_id);

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  const secureOutputValues = authorization.filterOutput(
    userTryingToGet,
    "read:user:self",
    userFound,
  );

  return response.status(200).json(secureOutputValues);
}

// Apaga a conta de quem pediu — ver `user.erase` para o que some e o que
// fica. Os cardápios que ela mandou continuam valendo para os lugares.
async function deleteHandler(request, response) {
  const userTryingToDelete = request.context.user;
  const erased = await user.erase(userTryingToDelete.id);

  // A sessão acabou junto com a conta: o cookie do navegador sai também.
  controller.clearSessionCookie(response);
  response.setHeader("Cache-Control", NO_STORE);

  return response.status(200).json({ deleted_at: erased.deleted_at });
}
