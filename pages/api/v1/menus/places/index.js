import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import menu from "models/menu.js";
import place from "models/place.js";

// Os lugares que têm cardápio — o que o botão "Cardápios" do aplicativo abre.
//
// `lat` e `lon` são opcionais e servem à ORDEM, como na busca: quem os manda
// recebe os mais próximos primeiro; quem não manda, os mais recentes.
//
// Como as outras rotas do mapa, NÃO passa por `injectAnonymousOrUser`: ver o
// cardápio de um lugar não depende de quem está olhando, e uma sessão vencida
// não pode esvaziar a lista.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

// Sem cache de borda: a resposta depende de onde a pessoa está, então cada um
// pede uma coisa diferente — e quem acabou de mandar um cardápio abre a lista
// esperando ver o lugar nela.
const NO_STORE = "no-store, no-cache, max-age=0, must-revalidate";

async function getHandler(request, response) {
  const origin = place.parseOrigin(request.query);
  const places = await menu.findPlaces(origin);

  response.setHeader("Cache-Control", NO_STORE);

  return response.status(200).json({ places });
}
