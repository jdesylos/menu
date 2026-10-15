import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import authorization from "models/authorization.js";
import auditLog from "models/auditLog.js";
import rateLimit from "models/rateLimit.js";
import { ForbiddenError, ServiceError } from "infra/errors.js";

// A chave do provedor de visão, entregue ao aplicativo.
//
// O aplicativo chama o provedor DIRETO: a foto do cardápio não passa por aqui,
// e esta rota existe só para ele saber com que chave falar. Isso foi decidido
// de olhos abertos, e o que se ganha é poder TROCAR a chave sem publicar
// versão nova do app — que é a única coisa que a Vercel consegue proteger
// neste desenho. Esconder a chave ela não esconde: quem chama o provedor a
// carrega em toda requisição, e quem intercepta o tráfego do aparelho a lê.
//
// Por isso o que limita o estrago de um vazamento não está neste arquivo: é o
// teto de gasto configurado na conta do provedor. Enquanto o plano for o
// gratuito, o pior caso é alguém queimar a cota do dia, e ninguém ler cardápio
// até o dia virar: o aplicativo não tem mais leitura no aparelho.
//
// Exige SESSÃO, de uma conta com `create:menu` — a mesma feature de mandar o
// cardápio, porque ler a folha é o primeiro passo de mandá-la, e quem não pode
// mandar não tem por que gastar a leitura. É o que dá um dono a cada chave
// entregue: sem conta, qualquer um com o aplicativo lia de graça, e não havia
// de quem tirar o acesso.
//
// O token estático abaixo continua, e não é autenticação de usuário: é uma
// tranca contra varredura automática, que separa "qualquer um que descubra a
// URL" de "alguém que abriu o aplicativo" — e é o interruptor da rota. Ele
// viaja dentro do aplicativo, e sai dele com `strings`: quem tem uma conta
// ativada e o aplicativo tem a chave.
//
// Cada entrega fica em `audit_logs` (`vision.key_delivered`), com a conta e o
// IP: num vazamento, é o que diz quem a pegou. E cada conta pega a chave no
// máximo 20 vezes por hora — o aplicativo a guarda na memória e só pede de
// novo ao abrir ou quando o provedor a recusa. O limite não impede um
// vazamento, porque uma entrega basta; impede uma conta de pedir sem parar.
export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(getHandler)
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const chave = process.env.GEMINI_API_KEY;
  const token = process.env.VISION_TOKEN;

  // Faltando qualquer uma das duas, a rota não existe na prática — e é assim
  // que ela se desliga: basta tirar a variável do ambiente. Sem o token, a
  // rota ficaria ABERTA, então a ausência dele também desliga; não há modo
  // "sem tranca" acidental.
  if (!chave || !token) {
    const indisponivel = new ServiceError({
      message: "A leitura remota não está configurada neste ambiente.",
      action: "Configure GEMINI_API_KEY e VISION_TOKEN para habilitá-la.",
    });
    // Devolvido aqui, e não lançado: o `onErrorHandler` só repassa alguns
    // tipos, e um `ServiceError` lançado viraria 500 — que diria "quebrou"
    // quando o certo é "não está ligada".
    return response.status(indisponivel.statusCode).json(indisponivel);
  }

  if (request.headers["x-vision-token"] !== token) {
    throw new ForbiddenError({
      message: "Token de leitura inválido.",
      action: "Use a versão do aplicativo publicada para este ambiente.",
    });
  }

  // Depois do token, e não num `canRequest` antes do handler: ambiente sem a
  // leitura configurada responde "não está ligada" a qualquer um, com ou sem
  // conta, e é assim que a rota se desliga.
  const userTryingToGet = request.context.user;
  if (!authorization.can(userTryingToGet, "create:menu")) {
    throw new ForbiddenError({
      message: "Você não possui permissão para executar esta ação.",
      action: 'Verifique se o seu usuário possui a feature "create:menu"',
    });
  }

  await rateLimit.check({
    identifier: `vision_key:user:${userTryingToGet.id}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });

  await auditLog.record({
    action: "vision.key_delivered",
    actorUserId: userTryingToGet.id,
    ip: controller.getClientIp(request),
  });

  // Nenhuma borda guarda chave: a resposta é secreta e trocável a qualquer
  // momento, e uma cópia em cache sobreviveria à troca.
  response.setHeader("Cache-Control", "no-store");

  return response.status(200).json({ key: chave });
}
