import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import user from "models/user.js";
import activation from "models/activation.js";
import auditLog from "models/auditLog.js";
import password from "models/password.js";
import { ValidationError } from "infra/errors.js";

// Criar uma conta. Do repositório judhagsan, em três pontos:
//
// - Cinco cadastros por IP a cada hora. Cada cadastro manda um email do nosso
//   domínio para o endereço que vier no corpo, e sem teto a rota servia para
//   encher de email a caixa de qualquer um — e queimar o domínio no provedor.
//
// - A mesma resposta para o email novo e para o que já tem conta. "O email já
//   está sendo utilizado" dizia a qualquer um, sem limite, quem tem conta
//   aqui. Quem fica sabendo da tentativa é o dono do email, por email.
//
// - O nome de usuário repetido continua dizendo que está em uso: o nome não é
//   segredo, e sem isso a pessoa não teria como escolher outro.
const GENERIC_SIGNUP_RESPONSE = {
  message:
    "Se este email ainda não estava cadastrado, enviamos um link de ativação. Verifique sua caixa de entrada.",
};

const DUPLICATE_EMAIL_MESSAGE = "O email informado já está sendo utilizado.";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .post(
    controller.rateLimit({
      key: "signup",
      limit: 5,
      windowMs: 60 * 60 * 1000,
    }),
    controller.canRequest("create:user"),
    postHandler,
  )
  .handler(controller.errorHandlers);

async function postHandler(request, response) {
  const userInputValues = request.body;
  const ip = controller.getClientIp(request);

  let newUser;
  try {
    newUser = await user.create(userInputValues);
  } catch (error) {
    if (
      error instanceof ValidationError &&
      error.message === DUPLICATE_EMAIL_MESSAGE
    ) {
      await answerAsIfCreated(userInputValues, ip);
      return response.status(201).json(GENERIC_SIGNUP_RESPONSE);
    }
    throw error;
  }

  const activationToken = await activation.create(newUser.id);
  await activation.sendEmailToUser(newUser, activationToken);

  await auditLog.record({
    action: "user.created",
    actorUserId: newUser.id,
    targetUserId: newUser.id,
    ip,
  });

  return response.status(201).json(GENERIC_SIGNUP_RESPONSE);
}

// O email já tem conta: avisa o dono e responde como se tivesse criado.
//
// O hash da senha está aqui só pelo TEMPO: criar uma conta passa por ele, e
// em produção são cerca de um segundo. Sem ele, o email repetido responderia
// um segundo mais rápido, e o relógio diria o que a resposta esconde. O tempo
// fica parecido, e não idêntico — o aviso é um email, como o da ativação.
//
// Falhar aqui não muda a resposta: uma falha que aparecesse só para email
// repetido seria outro jeito de dizer que ele existe.
async function answerAsIfCreated(userInputValues, ip) {
  try {
    await password.hash(String(userInputValues.password ?? ""));
    const existingUser = await user.findOneByEmail(userInputValues.email);
    await activation.sendDuplicateAccountNoticeToUser(existingUser);
    await auditLog.record({
      action: "user.signup_duplicate_email",
      targetUserId: existingUser.id,
      ip,
    });
  } catch (error) {
    console.error(error);
  }
}
