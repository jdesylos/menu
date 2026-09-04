import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import tile from "models/tile.js";

// Proxy do basemap vetorial da Protomaps.
//
// A rota existe por UM motivo: a chave da Protomaps não pode viajar dentro do
// aplicativo. Chave embutida em app nativo sai do APK com `unzip` e `strings`,
// e republicar o app não a revoga. Aqui ela vive só na variável de ambiente da
// Vercel, e o aplicativo pede o tile a nós.
//
// De quebra, o cache do CDN faz o mesmo tile pedido por mil pessoas bater uma
// vez só na Protomaps — que é o que mantém o consumo perto de zero.
//
// NÃO passa por `controller.injectAnonymousOrUser` de propósito: o mapa não
// depende de quem está olhando, e o middleware derruba a requisição com 401
// quando o cookie de sessão está vencido. O mapa sumir porque a sessão expirou
// seria defeito, não segurança.
export default createRouter().get(getHandler).handler(controller.errorHandlers);

// Um dia no aparelho, trinta no CDN. O basemap é reconstruído uma vez por dia
// pela Protomaps, então nada aqui envelhece rápido, e `stale-while-revalidate`
// deixa a borda servir o tile velho enquanto busca o novo — o usuário nunca
// espera pela revalidação.
const CACHE_CONTROL =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";

const VECTOR_TILE_CONTENT_TYPE = "application/vnd.mapbox-vector-tile";

async function getHandler(request, response) {
  const coordinates = tile.parseCoordinates(request.query);

  // Fora da área servida a resposta é um tile VAZIO, não um erro: o cliente
  // desenha nada e segue. Devolver 4xx faria o mapa piscar erro na borda do
  // recorte, que é comportamento normal e não falha.
  if (!tile.isWithinServedArea(coordinates)) {
    return sendTile(response, Buffer.alloc(0));
  }

  const { body } = await tile.fetchVectorTile(coordinates);

  return sendTile(response, body);
}

function sendTile(response, body) {
  response.setHeader("Content-Type", VECTOR_TILE_CONTENT_TYPE);
  response.setHeader("Cache-Control", CACHE_CONTROL);

  // 204 diz "não há nada aqui" sem gastar corpo. O cliente trata igual a um
  // tile sem feature nenhuma.
  if (body.length === 0) {
    return response.status(204).end();
  }

  return response.status(200).send(body);
}
