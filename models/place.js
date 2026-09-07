import database from "infra/database.js";
import tile from "models/tile.js";
import { ValidationError } from "infra/errors.js";

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

async function findWithinTile(coordinates) {
  const { west, east, south, north } = tile.bounds(coordinates);

  const results = await database.query({
    text: `
      SELECT
        name,
        category,
        latitude,
        longitude
      FROM
        places
      WHERE
        latitude BETWEEN $1 AND $2
        AND longitude BETWEEN $3 AND $4
      ORDER BY
        name
      LIMIT
        $5
    ;`,
    values: [south, north, west, east, MAX_PLACES_PER_TILE],
  });

  return results.rows;
}

const place = {
  MIN_ZOOM,
  MAX_ZOOM,
  MAX_PLACES_PER_TILE,
  parseCoordinates,
  findWithinTile,
};

export default place;
