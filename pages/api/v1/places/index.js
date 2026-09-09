import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import place from "models/place.js";

// A busca por nome, que alimenta as sugestões enquanto a pessoa digita.
//
// Irmã da rota por tile, e complementar a ela: o tile responde "o que existe
// nesta parte do mapa", e esta responde "onde está o lugar que eu sei o nome".
// Sem ela, achar um restaurante de outro bairro exigiria arrastar o mapa até
// ele — que é o contrário de procurar.
//
// `lat` e `lon` são opcionais e servem à ORDEM: dois lugares de mesmo nome
// existem às dezenas no país, e o que interessa a quem procura é o mais
// próximo. Quem não mandar recebe a lista em ordem alfabética.
//
// Como as outras rotas do mapa, NÃO passa por `injectAnonymousOrUser`: procurar
// restaurante não depende de quem está olhando, e uma sessão vencida não pode
// esvaziar a busca.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

// Bem menos que os tiles, e por um motivo: a resposta depende do texto
// digitado, então cada usuário pede uma coisa diferente e a borda guarda pouco
// proveito. Cinco minutos absorvem o repique de quem apaga uma letra e digita
// de novo, sem segurar o dado do mês passado.
const CACHE_CONTROL = "public, max-age=60, s-maxage=300";

async function getHandler(request, response) {
  const search = place.parseSearch(request.query);
  const places = await place.search(search);

  response.setHeader("Cache-Control", CACHE_CONTROL);

  return response.status(200).json({ places });
}
