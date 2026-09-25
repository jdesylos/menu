import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authorization from "models/authorization.js";
import placeSuggestion from "models/placeSuggestion.js";

// Sugerir mudança no mapa, e ver as sugestões.
//
// Fora de `/places` porque ali o Next já tem `[z]/[x]/[y]`: um `[id]` no mesmo
// nível do `[z]` é recusado pelo roteador, que não sabe qual dos dois é qual.
//
// O POST não usa `canRequest`: a feature depende do tipo — cadastrar exige
// `create:place`, o resto `update:place` — e o tipo só se sabe pelo corpo. A
// conferência acontece em `placeSuggestion.create`, com o mesmo 403.
export default createRouter()
  .use(controller.injectAnonymousOrUser)
  .post(postHandler)
  .get(controller.canRequest("read:session"), getHandler)
  .handler(controller.errorHandlers);

const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

async function postHandler(request, response) {
  const userTryingToSuggest = request.context.user;
  const suggestion = await placeSuggestion.create(
    userTryingToSuggest,
    request.body ?? {},
  );

  response.setHeader("Cache-Control", NO_STORE);
  return response
    .status(201)
    .json(
      authorization.filterOutput(
        userTryingToSuggest,
        "read:place_suggestion",
        suggestion,
      ),
    );
}

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const suggestions = await placeSuggestion.findAll(userTryingToGet, {
    status: request.query.status,
  });

  response.setHeader("Cache-Control", NO_STORE);
  return response.status(200).json({
    suggestions: suggestions.map((suggestion) =>
      authorization.filterOutput(
        userTryingToGet,
        "read:place_suggestion",
        suggestion,
      ),
    ),
  });
}
