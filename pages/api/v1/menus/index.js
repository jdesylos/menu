import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authorization from "models/authorization.js";
import menu from "models/menu.js";

// Mandar o cardápio de um lugar, e ler o que vale para ele.
//
// Fora de `/places` pelo mesmo motivo de `/suggestions`: ali o Next já tem
// `[z]/[x]/[y]`, e um `[id]` no mesmo nível do `[z]` é recusado pelo roteador.
// O lugar vem no corpo, no POST, e em `?place_id=`, no GET.
//
// Ler é público, como o mapa: saber o prato e o preço antes de chegar é o
// produto, e não pede conta. Mandar pede `create:menu`.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .post(controller.canRequest("create:menu"), postHandler)
  .get(getHandler)
  .handler(controller.errorHandlers);

const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

async function postHandler(request, response) {
  const userTryingToCreate = request.context.user;
  const created = await menu.create(userTryingToCreate, request.body);

  response.setHeader("Cache-Control", NO_STORE);
  return response
    .status(201)
    .json(authorization.filterOutput(userTryingToCreate, "read:menu", created));
}

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const found = await menu.findLatestByPlaceId(request.query.place_id);

  // Sem cache de borda: quem acabou de mandar um cardápio abre o lugar e
  // espera ver o que mandou, e não o de um minuto atrás.
  response.setHeader("Cache-Control", NO_STORE);
  return response
    .status(200)
    .json(authorization.filterOutput(userTryingToGet, "read:menu", found));
}
