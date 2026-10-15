import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import menuReading from "models/menuReading.js";
import { ValidationError } from "infra/errors.js";

// Ler a foto de um cardápio: o aplicativo manda a foto, e recebe o cardápio
// estruturado. Quem fala com o provedor de visão é o servidor, com a chave que
// só ele tem — ver `infra/gemini.js`.
//
// O corpo é a foto crua (`image/jpeg`), e não JSON: o `bodyParser` do Next
// está desligado, e a rota lê o corpo com o teto da foto.
//
// Exige sessão de uma conta com `create:menu`, a mesma feature de mandar o
// cardápio: ler a folha é o primeiro passo de mandá-la. Sem limite de leituras
// por conta, por decisão: a chave não sai daqui, e o que segura o gasto é o
// teto na conta do provedor. Cada leitura fica em `audit_logs`
// (`vision.read`), com a conta e o IP — é o que mostra quem está lendo.
//
// NÃO passa por `controller.shareDatabaseConnection`: a leitura leva de dez
// segundos a minutos, e a conexão dividida ficaria presa ao pedido o tempo
// todo, esperando o provedor.
export const config = {
  api: { bodyParser: false },
  // O teto da Vercel com o Fluid compute. Uma leitura com o provedor inteiro
  // sobrecarregado já levou quase três minutos para percorrer a cadeia.
  maxDuration: 300,
};

export default createRouter()
  .use(controller.injectAnonymousOrUser)
  .post(controller.canRequest("create:menu"), postHandler)
  .handler(controller.errorHandlers);

// Até quando a cadeia de modelos pode tentar: abaixo dos 300 s, para sobrar
// tempo de responder.
const DEADLINE_MS = 270_000;

async function postHandler(request, response) {
  const startedAt = Date.now();
  const userTryingToRead = request.context.user;
  const photo = await readPhoto(request);

  let reading;
  try {
    reading = await menuReading.read(photo, {
      deadline: startedAt + DEADLINE_MS,
    });
  } catch (error) {
    if (error instanceof menuReading.ReadingError) {
      console.error(
        JSON.stringify({
          event: "vision.read_failed",
          user_id: userTryingToRead.id,
          status: error.statusCode,
          ms: Date.now() - startedAt,
          path: error.path,
        }),
      );
      await record(request, userTryingToRead);
      return response.status(error.statusCode).json(error);
    }
    throw error;
  }

  // Quanto custou, para acompanhar o gasto. Sem a foto e sem o cardápio.
  console.log(
    JSON.stringify({
      event: "vision.read",
      user_id: userTryingToRead.id,
      model: reading.model,
      ms: Date.now() - startedAt,
      bytes: photo.length,
      usage: reading.usage,
      path: reading.path,
    }),
  );
  await record(request, userTryingToRead);

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    model: reading.model,
    menu: reading.menu,
  });
}

// Toda leitura que chegou ao provedor — a que deu certo e a que não deu.
async function record(request, user) {
  await auditLog.record({
    action: "vision.read",
    actorUserId: user.id,
    ip: controller.getClientIp(request),
  });
}

// O corpo, com o teto da foto: passado dele, para de ler e recusa.
async function readPhoto(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > menuReading.MAX_PHOTO_BYTES) {
      throw new ValidationError({
        message: "A foto passa de 3 MB.",
        action: "Reduza a foto antes de enviar.",
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
