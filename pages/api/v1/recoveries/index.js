import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import recovery from "models/recovery.js";
import auditLog from "models/auditLog.js";

// "Esqueci a senha": pede o link de recuperação por email.
//
// Sem sessão e sem feature — quem esqueceu a senha não está dentro. O que
// segura o abuso é o limite por IP: sem ele, a rota manda email a quem
// quiserem, quantas vezes quiserem.
export default createRouter()
  .use(controller.injectAnonymousOrUser)
  .post(
    controller.rateLimit({
      key: "recovery",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    postHandler,
  )
  .handler(controller.errorHandlers);

// A MESMA resposta com e sem conta: uma resposta que mudasse diria a quem
// perguntasse quais emails têm cadastro.
const SENT = {
  message:
    "Se houver uma conta com este email, enviamos um link para criar uma senha nova.",
};

async function postHandler(request, response) {
  const input = request.body || {};
  const ip = controller.getClientIp(request);

  const recoveryToken = await recovery.request(input.email);

  await auditLog.record({
    action: "recovery.requested",
    targetUserId: recoveryToken?.user_id,
    ip,
  });

  response.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  return response.status(201).json(SENT);
}
