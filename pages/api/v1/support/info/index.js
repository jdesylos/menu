import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import supportRequest from "models/supportRequest.js";

// Informações públicas de orientação e canal oficial de contato (Cláusula 1.2)
// consumidas pelo aplicativo mesmo antes da autenticação.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

function getHandler(request, response) {
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  return response.status(200).json(supportRequest.getSupportInfo());
}
