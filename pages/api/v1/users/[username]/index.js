import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import user from "models/user.js";
import authorization from "models/authorization.js";
import auditLog from "models/auditLog.js";
import { ForbiddenError, ValidationError } from "infra/errors.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  // Exige sessão: aberta, a rota respondia 200 para quem existe e 404 para quem
  // não existe, o que basta para levantar a lista de cadastrados. Nenhum
  // consumidor anônimo a chama. Veio do repositório judhagsan.
  .get(controller.canRequest("read:session"), getHandler)
  .patch(controller.canRequest("update:user"), patchHandler)
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const userTryingToGet = request.context.user;
  const username = request.query.username;
  const userFound = await user.findOneByUsername(username);

  const secureOutputValues = authorization.filterOutput(
    userTryingToGet,
    "read:user",
    userFound,
  );

  return response.status(200).json(secureOutputValues);
}

// Por aqui só se troca o nome. A senha tem rota própria, que pede a atual
// (`/user/password`), e o email não se troca: aceitar os dois sem pedir nada
// entregava a conta a quem estivesse com uma sessão na mão — trocava-se a
// senha sem saber a de antes, e o email sem confirmar o novo.
//
// Recusa, e não ignora, o que vier além do nome: quem mandou uma senha nova e
// ouvisse 200 acharia que a trocou.
async function patchHandler(request, response) {
  const username = request.query.username;
  const { username: newUsername, ...otherValues } = request.body || {};

  const userTryingToPatch = request.context.user;
  const targetUser = await user.findOneByUsername(username);

  if (!authorization.can(userTryingToPatch, "update:user", targetUser)) {
    throw new ForbiddenError({
      message: "Você não possui permissão para atualizar outro usuário.",
      action:
        "Verifique se você possui a feature necessária para atualizar outro usuário.",
    });
  }

  if (Object.keys(otherValues).length > 0) {
    throw new ValidationError({
      message: "Por aqui só se troca o nome de usuário.",
      action:
        "A senha se troca em /api/v1/user/password, que pede a senha atual.",
    });
  }

  const updatedUser = await user.changeUsername({
    userId: targetUser.id,
    newUsername,
  });

  await auditLog.record({
    action: "user.username_changed",
    actorUserId: userTryingToPatch.id,
    targetUserId: targetUser.id,
    ip: controller.getClientIp(request),
  });

  const secureOutputValues = authorization.filterOutput(
    userTryingToPatch,
    "read:user",
    updatedUser,
  );

  return response.status(200).json(secureOutputValues);
}
