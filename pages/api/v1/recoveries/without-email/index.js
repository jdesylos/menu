import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import accountRecovery from "models/accountRecovery.js";

const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

// Recuperação de conta sem acesso ao e-mail antigo (Cláusula 1.4).
// GET expõe a estrutura pública do questionário (sem campos de senha);
// POST avalia os sinais privados no servidor sob rate limit por IP e por alvo,
// enviando confirmação ao novo e-mail ou encaminhando para análise humana.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(getHandler)
  .post(
    controller.rateLimit({
      key: "account-recovery-ip",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    postHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  response.setHeader("Cache-Control", NO_STORE);
  return response.status(200).json(accountRecovery.getQuestions());
}

async function postHandler(request, response) {
  const ip = controller.getClientIp(request);
  const result = await accountRecovery.submit(request.body ?? {}, { ip });

  response.setHeader("Cache-Control", NO_STORE);
  return response.status(202).json(result);
}
