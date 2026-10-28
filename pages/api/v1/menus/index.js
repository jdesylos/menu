import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";
import menu from "models/menu.js";

// Mandar o cardápio de um lugar, e ler o que vale para ele.
//
// Fora de `/places` pelo mesmo motivo de `/suggestions`: ali o Next já tem
// `[z]/[x]/[y]`, e um `[id]` no mesmo nível do `[z]` é recusado pelo roteador.
// O lugar vem no corpo, no POST, e em `?place_id=`, no GET.
//
// Ler é público, como o mapa: saber o prato e o preço antes de chegar é o
// produto, e não pede conta. Mandar pede `create:menu`, e cada conta manda no
// máximo dez cardápios por hora, contando as trocas: ninguém revisa o que
// chega, e o primeiro cardápio de um lugar ainda apaga cinco tiles da borda.
//
// Trocar o cardápio que vale é o mesmo POST, com `replaces` — quem pode, e o
// quê, está em `menu.create`. Cada troca fica em `audit_logs`
// (`menu.replace`), com a conta e o IP.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .post(
    controller.canRequest("create:menu"),
    controller.rateLimit({
      key: "menu",
      limit: 10,
      windowMs: 60 * 60 * 1000,
      per: "user",
    }),
    postHandler,
  )
  .get(getHandler)
  .handler(controller.errorHandlers);

const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

async function postHandler(request, response) {
  const userTryingToCreate = request.context.user;
  const created = await menu.create(userTryingToCreate, request.body);

  if (created.replaces_menu_id) {
    await auditLog.record({
      action: "menu.replace",
      actorUserId: userTryingToCreate.id,
      ip: controller.getClientIp(request),
    });
  }

  response.setHeader("Cache-Control", NO_STORE);
  return response
    .status(201)
    .json(authorization.filterOutput(userTryingToCreate, "read:menu", created));
}

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const found = await menu.findLatestByPlaceId(request.query.place_id);

  // Com a sessão de quem o mandou, o aplicativo oferece editar o texto. Sem
  // sessão é sempre `false`, e ler continua público.
  found.can_edit = menu.canEditText(userTryingToGet, found);

  // Sem cache de borda: quem acabou de mandar um cardápio abre o lugar e
  // espera ver o que mandou, e não o de um minuto atrás — e a resposta muda
  // com quem pergunta.
  response.setHeader("Cache-Control", NO_STORE);
  return response
    .status(200)
    .json(authorization.filterOutput(userTryingToGet, "read:menu", found));
}
