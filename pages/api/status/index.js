import { createRouter } from "next-connect";
import controller from "infra/controller.js";

// Atalho servido em `/status` via rewrite no `next.config.js`: devolve o
// apontamento JSON sem gerar bundle React nem ciclo de SSR.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

function getHandler(request, response) {
  response.setHeader("Cache-Control", CACHE_CONTROL);
  return response.status(200).json({
    status: "/api/v1/status",
  });
}
