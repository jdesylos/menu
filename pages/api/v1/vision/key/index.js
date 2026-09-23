import { createRouter } from "next-connect";
import controller from "infra/controller.js";
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
// gratuito, o pior caso é alguém queimar a cota do dia, e o aplicativo cair no
// OCR que roda no próprio aparelho.
//
// NÃO exige sessão, por decisão para os testes iniciais. O token estático
// abaixo não é autenticação de usuário: é uma tranca contra varredura
// automática, que separa "qualquer um que descubra a URL" de "alguém que
// abriu o aplicativo". Quando o app tiver login no fluxo de captura, esta rota
// passa por `injectAnonymousOrUser` como as outras.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

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

  // Nenhuma borda guarda chave: a resposta é secreta e trocável a qualquer
  // momento, e uma cópia em cache sobreviveria à troca.
  response.setHeader("Cache-Control", "no-store");

  return response.status(200).json({ key: chave });
}
