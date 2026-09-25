import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import place from "models/place.js";

// Os estabelecimentos que o mapa do aplicativo marca, endereçados por TILE.
//
// Por tile, e não por raio, porque é assim que o aplicativo já pede o mapa: ele
// tem o cache por tile, sabe quais estão na tela e descarta os que saíram. Uma
// consulta por raio obrigaria um segundo caminho de cache para o mesmo dado.
//
// A fonte é o Overture Places, carregado no banco por
// `infra/scripts/import-places.js` — o OpenStreetMap que vem no basemap cobre
// bem o centro das cidades e quase nada na periferia.
//
// Como a rota de tiles, NÃO passa por `controller.injectAnonymousOrUser`: o
// mapa não depende de quem está olhando, e uma sessão vencida não pode fazer
// os restaurantes sumirem da tela.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

// Uma hora, no aparelho e na borda, com `stale-while-revalidate` para a borda
// nunca fazer o usuário esperar pela revalidação.
//
// Eram trinta dias no CDN, quando o dado só mudava com o release mensal do
// Overture. Com sugestões de usuário, uma correção aceita — ver
// `models/placeSuggestion.js` — levaria até um mês para aparecer no mapa. O
// preço é o banco responder cada tile uma vez por hora por região da borda, em
// vez de uma vez por mês.
const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

async function getHandler(request, response) {
  const coordinates = place.parseCoordinates(request.query);
  const places = await place.findWithinTile(coordinates);

  response.setHeader("Cache-Control", CACHE_CONTROL);

  return response.status(200).json({ places });
}
