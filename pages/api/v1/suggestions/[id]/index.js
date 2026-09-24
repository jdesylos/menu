import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authorization from "models/authorization.js";
import placeSuggestion from "models/placeSuggestion.js";

// Aceitar ou recusar uma sugestão — o que muda o mapa de todo mundo, e por
// isso exige `manage:place`, e não `admin`: ver `models/authorization.js`.
export default createRouter()
  .use(controller.injectAnonymousOrUser)
  .patch(controller.canRequest("manage:place"), patchHandler)
  .handler(controller.errorHandlers);

async function patchHandler(request, response) {
  const userTryingToReview = request.context.user;
  const suggestion = await placeSuggestion.review(
    userTryingToReview,
    request.query.id,
    request.body?.status,
  );

  response.setHeader("Cache-Control", "no-store, no-cache, max-age=0");
  return response
    .status(200)
    .json(
      authorization.filterOutput(
        userTryingToReview,
        "read:place_suggestion",
        suggestion,
      ),
    );
}
