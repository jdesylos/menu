import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authentication from "models/authentication.js";
import authorization from "models/authorization.js";
import session from "models/session.js";
import auditLog from "models/auditLog.js";

import { ForbiddenError, UnauthorizedError } from "infra/errors.js";

// Cinco tentativas de login por IP a cada quinze minutos, como no repositório
// judhagsan. Sem isto, a rota respondia a qualquer ritmo, e adivinhar senha
// era questão de paciência.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .post(
    controller.rateLimit({
      key: "login",
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }),
    controller.canRequest("create:session"),
    postHandler,
  )
  .delete(deleteHandler)
  .handler(controller.errorHandlers);

async function postHandler(request, response) {
  const userInputValues = request.body;
  const ip = controller.getClientIp(request);

  let authenticatedUser;
  try {
    authenticatedUser = await authentication.getUser(
      userInputValues.email,
      userInputValues.password,
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await auditLog.record({ action: "session.failed", ip });
    }
    throw error;
  }

  if (!authorization.can(authenticatedUser, "create:session")) {
    await auditLog.record({
      action: "session.forbidden",
      actorUserId: authenticatedUser.id,
      ip,
    });
    // A conta que ainda espera o link de ativação ouve o que fazer, e não a
    // recusa genérica, que mandava procurar o suporte. Não revela nada a
    // ninguém: só chega aqui quem acertou o email E a senha.
    if (authorization.can(authenticatedUser, "read:activation_token")) {
      throw new ForbiddenError({
        message: "Sua conta ainda não foi ativada.",
        action:
          "Abra o link que enviamos para o seu email no celular em que o aplicativo está instalado.",
      });
    }
    throw new ForbiddenError({
      message: "Você não possui permissão para fazer login.",
      action: "Contate o suporte caso você acredite que isto seja um erro.",
    });
  }

  const newSession = await session.create(authenticatedUser.id);

  controller.setSessionCookie(newSession.token, response);

  await auditLog.record({
    action: "session.created",
    actorUserId: authenticatedUser.id,
    ip,
  });

  const secureOutputValues = authorization.filterOutput(
    authenticatedUser,
    "read:session",
    newSession,
  );

  return response.status(201).json(secureOutputValues);
}

async function deleteHandler(request, response) {
  const userTryingToDelete = request.context.user;
  const sessionToken = request.cookies.session_id;
  const ip = controller.getClientIp(request);

  const sessionObject = await session.findOneValidByToken(sessionToken);
  const expiredSession = await session.expireById(sessionObject.id);
  controller.clearSessionCookie(response);

  await auditLog.record({
    action: "session.deleted",
    actorUserId: userTryingToDelete.id,
    ip,
  });

  const secureOutputValues = authorization.filterOutput(
    userTryingToDelete,
    "read:session",
    expiredSession,
  );

  return response.status(200).json(secureOutputValues);
}
