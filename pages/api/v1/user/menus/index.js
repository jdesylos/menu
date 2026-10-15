import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import menu from "models/menu.js";

// Os lugares para onde quem está com a sessão mandou cardápio — a aba "Meus
// cardápios" do aplicativo.
//
// Mora em `/user`, como a senha e o nome: de quem são os cardápios sai da
// sessão, e não do endereço. A resposta tem a forma da de
// `/api/v1/menus/places`, para o aplicativo ler as duas listas do mesmo
// jeito.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(controller.canRequest("read:session"), getHandler)
  .handler(controller.errorHandlers);

// Sem cache: a resposta é de uma conta, e quem acabou de mandar um cardápio
// abre a aba esperando ver o lugar nela.
const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const places = await menu.findPlacesByCreator(userTryingToGet.id);

  response.setHeader("Cache-Control", NO_STORE);
  return response.status(200).json({ places });
}
