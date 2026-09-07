import { ValidationError, ServiceError } from "infra/errors.js";

// A Protomaps publica o basemap até o zoom 15; pedir além disso devolve tile
// vazio e gasta cota à toa.
const MAX_ZOOM = 15;

const PROTOMAPS_TILE_URL = "https://api.protomaps.com/tiles/v4";

// Caixa que cobre o Brasil com folga (inclui Fernando de Noronha e a ponta do
// Chuí). Ver `isWithinServedArea` para o porquê de existir.
const SERVED_AREA = {
  minLongitude: -74.5,
  maxLongitude: -32.0,
  minLatitude: -34.5,
  maxLatitude: 6.0,
};

// Abaixo deste zoom o mundo inteiro cabe em poucas centenas de tiles, e eles
// dão o contexto de "onde no planeta" ao redor da borda. Recortar aqui só
// criaria buraco visível sem economizar nada.
const WORLDWIDE_UNTIL_ZOOM = 5;

// `maxZoom` é parâmetro porque nem todo dado para no mesmo zoom: o basemap da
// Protomaps termina em 15, mas os estabelecimentos vão além disso — e a conta
// de coordenada é a mesma para os dois. Duas cópias dela divergiriam no dia em
// que uma fosse corrigida.
function parseCoordinates(rawCoordinates, { maxZoom = MAX_ZOOM } = {}) {
  const { z, x, y } = rawCoordinates;

  const zoom = parseTileInteger(z, "z");
  const column = parseTileInteger(x, "x");
  const row = parseTileInteger(y, "y");

  if (zoom > maxZoom) {
    throw new ValidationError({
      message: `O zoom "${zoom}" está acima do máximo disponível.`,
      action: `Use um zoom entre 0 e ${maxZoom}.`,
    });
  }

  // Em cada zoom o mundo é uma grade de 2^z por 2^z. Fora dela não existe
  // tile, e deixar passar viraria uma chamada desperdiçada à Protomaps.
  const gridSize = 2 ** zoom;
  if (column >= gridSize || row >= gridSize) {
    throw new ValidationError({
      message: `O tile "${zoom}/${column}/${row}" está fora da grade deste zoom.`,
      action: `Neste zoom, "x" e "y" vão de 0 a ${gridSize - 1}.`,
    });
  }

  return { zoom, column, row };
}

function parseTileInteger(value, name) {
  // `parseInt` aceitaria "12abc" e o Number() aceitaria "1e2" e " 12 ";
  // a coordenada precisa ser exatamente uma sequência de dígitos.
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ValidationError({
      message: `A coordenada "${name}" precisa ser um número inteiro positivo.`,
      action: `Envie "${name}" como um número inteiro, sem sinal nem separador.`,
    });
  }

  return Number(value);
}

// Sem isto a rota é um tile server aberto: qualquer um aponta um mapa para ela
// e varre o planeta na cota da nossa chave. Como o app só mostra restaurantes
// no Brasil, recortar a área derruba o espaço de varredura em ordens de
// grandeza — e é a defesa que dá para fazer sem guardar estado.
//
// Não substitui rate limit de verdade, que exige contador compartilhado e
// ainda não existe aqui.
function isWithinServedArea(coordinates) {
  if (coordinates.zoom <= WORLDWIDE_UNTIL_ZOOM) {
    return true;
  }

  const { west, east, north, south } = bounds(coordinates);

  return (
    east > SERVED_AREA.minLongitude &&
    west < SERVED_AREA.maxLongitude &&
    north > SERVED_AREA.minLatitude &&
    south < SERVED_AREA.maxLatitude
  );
}

// A caixa de lat/lon que um tile cobre.
//
// Exportada porque a rota de estabelecimentos pergunta exatamente isto ao
// banco — "o que existe dentro deste tile" —, e refazer a conversão lá seria a
// segunda conta que diverge da primeira.
function bounds({ zoom, column, row }) {
  const gridSize = 2 ** zoom;

  return {
    west: tileColumnToLongitude(column, gridSize),
    east: tileColumnToLongitude(column + 1, gridSize),
    // A grade cresce para o SUL, então a linha `row` é a borda NORTE do tile.
    north: tileRowToLatitude(row, gridSize),
    south: tileRowToLatitude(row + 1, gridSize),
  };
}

function tileColumnToLongitude(column, gridSize) {
  return (column / gridSize) * 360 - 180;
}

function tileRowToLatitude(row, gridSize) {
  // Inversa da projeção de Mercator: a latitude não é linear na grade.
  const n = Math.PI - 2 * Math.PI * (row / gridSize);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function fetchVectorTile({ zoom, column, row }) {
  const apiKey = process.env.PROTOMAPS_API_KEY;

  if (!apiKey) {
    throw new ServiceError({
      message: "O serviço de mapas não está configurado.",
      action: "Defina PROTOMAPS_API_KEY nas variáveis de ambiente.",
      context: { service: "protomaps" },
    });
  }

  const upstreamUrl = `${PROTOMAPS_TILE_URL}/${zoom}/${column}/${row}.mvt?key=${apiKey}`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl);
  } catch (error) {
    throw new ServiceError({
      cause: error,
      message: "Não foi possível falar com o serviço de mapas.",
      action: "Tente novamente em alguns instantes.",
      context: { service: "protomaps" },
    });
  }

  // 404 aqui é tile sem dado (oceano aberto, por exemplo), não erro: a resposta
  // certa para o cliente é um tile vazio, que ele desenha como nada.
  if (upstreamResponse.status === 404 || upstreamResponse.status === 204) {
    return { body: Buffer.alloc(0), isEmpty: true };
  }

  if (!upstreamResponse.ok) {
    throw new ServiceError({
      message: "O serviço de mapas respondeu com erro.",
      action: "Tente novamente em alguns instantes.",
      context: { service: "protomaps", status: upstreamResponse.status },
    });
  }

  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  return { body, isEmpty: body.length === 0 };
}

const tile = {
  MAX_ZOOM,
  parseCoordinates,
  isWithinServedArea,
  bounds,
  fetchVectorTile,
};

export default tile;
