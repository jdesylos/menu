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

// As camadas do basemap que o aplicativo NÃO desenha, e que por isso não
// viajam.
//
// `pois` são os pontos do OpenStreetMap — restaurantes inclusive —, que o mapa
// do aplicativo ignora de propósito: os lugares de comer vêm do banco, pela
// rota `/places`. `places` são os nomes de bairro e de cidade, que ele também
// não escreve. Medido no tile de z15 da Praça da Sé: 228 KB ao todo, 41 KB de
// `pois` e 1 KB de `places` — quase um quinto do tile, baixado em rede móvel
// para ser jogado fora.
//
// É a lista do que SAI, e não do que fica: camada nova que a Protomaps
// publique continua passando, e o aplicativo decide o que faz com ela. Uma
// lista do que fica obrigaria a mexer aqui antes de o aplicativo poder
// desenhar qualquer coisa nova.
const UNUSED_LAYERS = ["pois", "places"];

// No protobuf, cada campo começa por uma etiqueta: o número do campo e, nos
// três bits de baixo, como o valor está escrito.
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

// No tile vetorial, as camadas são o campo 3 da mensagem, e o nome de cada
// uma é o campo 1 da camada.
const TILE_LAYERS_FIELD = 3;
const LAYER_NAME_FIELD = 1;

// Tira do tile as camadas de `UNUSED_LAYERS`, sem decodificar a geometria.
//
// Um tile vetorial é uma mensagem protobuf cujo primeiro nível é uma sequência
// de camadas, e cada camada traz o próprio nome. Basta andar por esse primeiro
// nível e copiar, byte a byte, as camadas que ficam: nenhuma dependência nova,
// e nada do que o aplicativo lê é reescrito.
//
// Qualquer coisa fora do esperado devolve o tile COMO VEIO. Mandar um tile
// maior do que precisava é desperdício; mandar um tile cortado no meio é o
// mapa sem desenhar.
function dropUnusedLayers(body) {
  const kept = [];
  let droppedAny = false;

  try {
    let offset = 0;
    while (offset < body.length) {
      const field = readField(body, offset);

      const isUnusedLayer =
        field.number === TILE_LAYERS_FIELD &&
        field.wireType === WIRE_LENGTH_DELIMITED &&
        UNUSED_LAYERS.includes(readLayerName(body, field.start, field.end));

      if (isUnusedLayer) {
        droppedAny = true;
      } else {
        kept.push(body.subarray(offset, field.end));
      }

      offset = field.end;
    }
  } catch {
    return body;
  }

  return droppedAny ? Buffer.concat(kept) : body;
}

// O nome de uma camada, que ocupa `buffer[start..end]`. Sem nome, `null` — e
// a camada fica: só sai o que se sabe que não serve.
function readLayerName(buffer, start, end) {
  let offset = start;
  while (offset < end) {
    const field = readField(buffer, offset, end);

    if (
      field.number === LAYER_NAME_FIELD &&
      field.wireType === WIRE_LENGTH_DELIMITED
    ) {
      return buffer.toString("utf8", field.start, field.end);
    }

    offset = field.end;
  }

  return null;
}

// Um campo protobuf a partir de `offset`: o número, o tipo, e onde o valor
// começa e termina. Lança diante de qualquer coisa que não caiba em `limit` —
// quem chama trata como tile que não se sabe ler.
function readField(buffer, offset, limit = buffer.length) {
  const tag = readVarint(buffer, offset, limit);
  // Divisão, e não deslocamento de bits: o deslocamento do JavaScript trunca
  // em 32 bits, e a etiqueta é um inteiro de até 64.
  const number = Math.floor(tag.value / 8);
  const wireType = tag.value % 8;

  let start = tag.end;
  let end;

  if (wireType === WIRE_VARINT) {
    end = readVarint(buffer, start, limit).end;
  } else if (wireType === WIRE_FIXED64) {
    end = start + 8;
  } else if (wireType === WIRE_FIXED32) {
    end = start + 4;
  } else if (wireType === WIRE_LENGTH_DELIMITED) {
    const length = readVarint(buffer, start, limit);
    start = length.end;
    end = start + length.value;
  } else {
    throw new RangeError(`Tipo de campo desconhecido: ${wireType}.`);
  }

  if (end > limit) {
    throw new RangeError("O campo passa do fim da mensagem.");
  }

  return { number, wireType, start, end };
}

// Um inteiro de tamanho variável: sete bits por byte, do menos significativo
// para o mais, e o bit de cima dizendo se há mais um byte.
function readVarint(buffer, offset, limit) {
  // Dez bytes guardam 64 bits; mais que isso não é um inteiro.
  const MAX_BYTES = 10;

  let value = 0;
  for (let index = 0; index < MAX_BYTES; index++) {
    if (offset + index >= limit) {
      break;
    }

    const byte = buffer[offset + index];
    value += (byte & 0x7f) * 2 ** (7 * index);

    if (byte < 0x80) {
      return { value, end: offset + index + 1 };
    }
  }

  throw new RangeError("Inteiro sem fim na mensagem.");
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
  dropUnusedLayers,
};

export default tile;
