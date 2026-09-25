import database from "infra/database.js";
import tile from "models/tile.js";
import { NotFoundError, ValidationError } from "infra/errors.js";

// Abaixo de 14 um tile cobre uma cidade inteira, e a resposta seria de
// milhares de lugares que o aplicativo não teria como desenhar sem virar uma
// mancha. Quem quer visão de cidade não quer a lista de bares dela.
const MIN_ZOOM = 14;

// Acima de 18 o tile cobre menos que um quarteirão: pedir nessa escala só
// multiplicaria requisições para devolver os mesmos poucos lugares.
const MAX_ZOOM = 18;

// Teto por tile. Num tile de zoom 14 no centro de São Paulo cabem centenas de
// estabelecimentos; o aplicativo desenha algumas dezenas, e trazer o resto
// gastaria banda de rede para nada.
//
// O teto MORDE: medido no release 2026-08-19.0 do Overture, o tile de z14 da
// Liberdade tem 1709 lugares e o de z15, 366. Por isso o aplicativo pede em
// z16, onde o tile mais cheio da cidade de São Paulo tem 272. Quando o teto
// morder mesmo assim, quem fica de fora é decidido pela ordem em
// `findWithinTile`.
const MAX_PLACES_PER_TILE = 300;

function parseCoordinates(rawCoordinates) {
  const coordinates = tile.parseCoordinates(rawCoordinates, {
    maxZoom: MAX_ZOOM,
  });

  if (coordinates.zoom < MIN_ZOOM) {
    throw new ValidationError({
      message: `O zoom "${coordinates.zoom}" é baixo demais para estabelecimentos.`,
      action: `Use um zoom entre ${MIN_ZOOM} e ${MAX_ZOOM}.`,
    });
  }

  return coordinates;
}

// Quantas letras a busca exige antes de responder.
//
// Duas. Com uma só, "a" casa com metade da tabela e a lista de sugestões vira
// uma amostra do país inteiro — e ainda custa a varredura para montá-la. Duas
// já recortam o bastante para a lista dizer alguma coisa.
const MIN_SEARCH_LENGTH = 2;

// Quantas sugestões a busca devolve.
//
// Oito, que é o que cabe embaixo da barra de busca sem cobrir o mapa. Não é
// paginação: quem não achou nas oito primeiras precisa digitar mais, não
// rolar uma lista.
const MAX_SEARCH_RESULTS = 8;

// O que o cliente pode mandar como coordenada, para ordenar por perto.
const LATITUDE_LIMIT = 90;
const LONGITUDE_LIMIT = 180;

function parseSearch(query) {
  const term = (query.q ?? "").trim();

  if (term.length < MIN_SEARCH_LENGTH) {
    throw new ValidationError({
      message: "A busca precisa de pelo menos duas letras.",
      action: "Digite mais um caractere e tente de novo.",
    });
  }

  return {
    term,
    ...parseOrigin(query),
  };
}

// De onde se está procurando. Opcional: sem ela a lista sai em ordem
// alfabética, que é pior mas continua sendo uma lista.
//
// Vem do cliente porque é ele que sabe: o servidor só veria o IP, que numa
// rede móvel aponta para a operadora e não para a esquina.
function parseOrigin(query) {
  const hasOrigin = query.lat !== undefined || query.lon !== undefined;

  if (!hasOrigin) {
    return { latitude: null, longitude: null };
  }

  const latitude = Number(query.lat);
  const longitude = Number(query.lon);

  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= LATITUDE_LIMIT &&
    Math.abs(longitude) <= LONGITUDE_LIMIT;

  if (!valid) {
    throw new ValidationError({
      message: `A origem "${query.lat},${query.lon}" não é uma coordenada.`,
      action: "Envie `lat` e `lon` em graus decimais, ou nenhum dos dois.",
    });
  }

  return { latitude, longitude };
}

// Os lugares cujo nome contém o que foi digitado, os mais perto primeiro.
//
// CONTÉM, e não começa com: quem digita "boteco" quer achar "O Boteco" também,
// e quem digita "pizza" espera a lista inteira de pizzarias. Quem começa com o
// termo aparece antes — é o casamento mais provável —, e o desempate é a
// distância a quem procura.
//
// Acento não conta, nos dois lados: "cafe" acha "Café" e "café" acha "Cafe".
// O teclado do Android não entrega acento ao aplicativo, e sem isto nenhum
// lugar com acento no nome era achado por lá. A comparação passa pela mesma
// "sem_acento" do índice — ver a migration "busca-sem-acento-em-places" —, e é
// isso que mantém a busca no índice em vez de varrer a tabela.
//
// A ordenação por distância usa graus, não metros: comparar quadrados de
// diferença basta para ordenar, e o cosseno da latitude corrige o encolhimento
// da longitude longe do equador. Uma raiz quadrada aqui só custaria tempo para
// devolver a mesma ordem.
async function search({ term, latitude, longitude }) {
  const hasOrigin = latitude !== null && longitude !== null;

  const values = [`%${escapeLike(term)}%`, `${escapeLike(term)}%`];
  if (hasOrigin) {
    values.push(latitude, longitude);
  }
  values.push(MAX_SEARCH_RESULTS);

  // A ordem, em pedaços: primeiro quem começa com o termo, depois — só quando
  // se sabe de onde a pessoa procura — a distância até ela, e o nome como
  // desempate final.
  //
  // Sem origem o pedaço do meio some da lista em vez de virar uma constante:
  // `ORDER BY 0` no Postgres é a POSIÇÃO da coluna zero, não o número zero, e
  // a consulta inteira falha.
  const ordering = [`(sem_acento(name) ILIKE sem_acento($2) ESCAPE '\\') DESC`];
  if (hasOrigin) {
    ordering.push(`(latitude - $3) * (latitude - $3)
        + (longitude - $4) * (longitude - $4)
        * power(cos(radians($3)), 2)`);
  }
  ordering.push("name");

  const results = await database.query({
    text: `
      SELECT
        id,
        name,
        category,
        latitude,
        longitude,
        street,
        neighborhood,
        locality,
        region,
        postcode
      FROM
        places
      WHERE
        sem_acento(name) ILIKE sem_acento($1) ESCAPE '\\'
        AND hidden_at IS NULL
      ORDER BY
        ${ordering.join(",\n        ")}
      LIMIT
        $${values.length}
    ;`,
    values,
  });

  return results.rows;
}

// `%`, `_` e a própria barra são curingas do LIKE. Sem escapar, procurar por
// "100%" traria a tabela inteira, e um nome com underscore casaria com
// qualquer letra no lugar dele.
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// O endereço viaja no TILE, e não só na busca.
//
// O aplicativo abre um painel quando se toca no marcador do restaurante, e o
// endereço é o conteúdo dele. Os marcadores vêm daqui — do tile —, então sem o
// endereço nesta consulta o painel teria de fazer uma segunda requisição por
// toque, para buscar pelo nome um lugar que ele já tem na mão.
//
// Custa cerca de sessenta bytes por lugar: uns dez quilobytes num tile cheio,
// que a borda guarda por trinta dias junto do resto da resposta.
//
// A ordem é pelo `id`, e não pelo nome, porque é ela que decide quem cai
// quando o tile passa de `MAX_PLACES_PER_TILE`. Em ordem alfabética o corte
// apagava um pedaço do ALFABETO: na Liberdade, em z15, tudo depois de
// "SnowFall Brasil" sumia do mapa — Udon Jinbei, Thai Chef, Sushi Kenzo. O id
// é um UUID aleatório, então o corte vira uma amostra espalhada pelo tile
// inteiro, a mesma a cada pedido, e sai do índice da chave primária.
//
// O que está oculto não entra — fechou, é duplicata de outro ou sumiu da
// fonte; ver a migration "ocultar-places-em-vez-de-apagar". A busca aplica o
// mesmo filtro.
async function findWithinTile(coordinates) {
  const { west, east, south, north } = tile.bounds(coordinates);

  const results = await database.query({
    text: `
      SELECT
        id,
        name,
        category,
        latitude,
        longitude,
        street,
        neighborhood,
        locality,
        region,
        postcode
      FROM
        places
      WHERE
        latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
        AND hidden_at IS NULL
      ORDER BY
        id
      LIMIT
        $5
    ;`,
    values: [south, north, west, east, MAX_PLACES_PER_TILE],
  });

  return results.rows;
}

// Um lugar pelo id, visível ou não — quem chama decide o que fazer com o
// oculto. Sem o lugar, `NotFoundError`, com o texto que o aplicativo mostra.
async function findOneById(id) {
  // Id que nem tem forma de UUID não existe, e passá-lo ao Postgres viraria
  // erro de sintaxe — um 500 no lugar do 404.
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw placeNotFound();
  }

  const results = await database.query({
    text: `
      SELECT
        *
      FROM
        places
      WHERE
        id = $1
      LIMIT
        1
    ;`,
    values: [id],
  });

  if (results.rowCount === 0) {
    throw placeNotFound();
  }

  return results.rows[0];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function placeNotFound() {
  return new NotFoundError({
    message: "O lugar informado não foi encontrado.",
    action: "Verifique se o lugar ainda aparece no mapa e tente de novo.",
  });
}

const place = {
  MIN_ZOOM,
  MAX_ZOOM,
  MAX_PLACES_PER_TILE,
  MIN_SEARCH_LENGTH,
  MAX_SEARCH_RESULTS,
  parseCoordinates,
  findWithinTile,
  parseSearch,
  search,
  findOneById,
  UUID_PATTERN,
};

export default place;
