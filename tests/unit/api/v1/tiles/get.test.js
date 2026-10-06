import { gunzipSync } from "node:zlib";
import rota from "pages/api/v1/tiles/[z]/[x]/[y].js";
import tile from "models/tile.js";

// A Protomaps não entra: o modelo devolve o tile que cada teste disser, e o
// que se afirma é o que a ROTA faz com ele — o que tira e como manda. O resto
// do modelo é o de verdade.
jest.mock("models/tile.js", () => {
  const { default: real } = jest.requireActual("models/tile.js");
  return {
    __esModule: true,
    default: { ...real, fetchVectorTile: jest.fn() },
  };
});

// Teste de UNIDADE, e não de integração como o resto da rota: o caminho que
// devolve um tile de verdade sai para a internet, e por isso fica fora da
// suíte de integração — ver `tests/integration/api/v1/tiles/get.test.js`.
afterEach(() => {
  jest.resetAllMocks();
});

// z15 sobre a Praça da Sé: dentro da área servida.
function pedido(headers = {}) {
  return {
    method: "GET",
    url: "/api/v1/tiles/15/12139/18590",
    query: { z: "15", x: "12139", y: "18590" },
    headers,
  };
}

function resposta() {
  const r = {
    statusCode: null,
    corpo: null,
    headers: {},
    status(codigo) {
      r.statusCode = codigo;
      return r;
    },
    setHeader(nome, valor) {
      r.headers[nome] = valor;
    },
    send(corpo) {
      r.corpo = corpo;
      return r;
    },
    json(corpo) {
      r.corpo = JSON.parse(JSON.stringify(corpo));
      return r;
    },
    end() {
      return r;
    },
  };
  return r;
}

// Uma camada de tile vetorial montada à mão: o campo 3 da mensagem, com o
// nome (campo 1) e um recheio no lugar das feições (campo 2). Tudo abaixo de
// 128 bytes, para cada tamanho caber num byte só.
function camada(nome, recheio) {
  const conteudo = Buffer.concat([
    Buffer.from([0x0a, nome.length]),
    Buffer.from(nome),
    Buffer.from([0x12, recheio]),
    Buffer.alloc(recheio, 0x2a),
  ]);
  return Buffer.concat([Buffer.from([0x1a, conteudo.length]), conteudo]);
}

const RUAS = camada("roads", 60);
const TILE = Buffer.concat([camada("pois", 90), RUAS]);

describe("GET /api/v1/tiles/[z]/[x]/[y]", () => {
  test("manda comprimido, e sem o que o aplicativo não desenha, a quem aceita gzip", async () => {
    tile.fetchVectorTile.mockResolvedValue({ body: TILE });

    const r = resposta();
    await rota(pedido({ "accept-encoding": "gzip" }), r);

    expect(r.statusCode).toBe(200);
    expect(r.headers["Content-Encoding"]).toBe("gzip");
    // São duas respostas para o mesmo endereço, e a borda precisa saber.
    expect(r.headers["Vary"]).toBe("Accept-Encoding");
    expect(r.headers["Content-Type"]).toBe(
      "application/vnd.mapbox-vector-tile",
    );
    expect(gunzipSync(r.corpo)).toEqual(RUAS);
  });

  test("aceita gzip entre outras codificações", async () => {
    tile.fetchVectorTile.mockResolvedValue({ body: TILE });

    const r = resposta();
    await rota(
      pedido({ "accept-encoding": "br;q=1.0, GZIP;q=0.8, *;q=0.1" }),
      r,
    );

    expect(r.headers["Content-Encoding"]).toBe("gzip");
    expect(gunzipSync(r.corpo)).toEqual(RUAS);
  });

  test("manda sem comprimir a quem não pede", async () => {
    tile.fetchVectorTile.mockResolvedValue({ body: TILE });

    const r = resposta();
    await rota(pedido(), r);

    expect(r.statusCode).toBe(200);
    expect(r.headers["Content-Encoding"]).toBeUndefined();
    expect(r.headers["Vary"]).toBe("Accept-Encoding");
    expect(r.corpo).toEqual(RUAS);
  });

  test("manda sem comprimir a quem recusa gzip", async () => {
    tile.fetchVectorTile.mockResolvedValue({ body: TILE });

    for (const recusa of ["identity", "gzip;q=0", "gzip; q=0.0, br"]) {
      const r = resposta();
      await rota(pedido({ "accept-encoding": recusa }), r);

      expect(r.headers["Content-Encoding"]).toBeUndefined();
      expect(r.corpo).toEqual(RUAS);
    }
  });

  // Tirado o que não se desenha, não sobrou nada: é um tile vazio, como o de
  // oceano aberto.
  test("responde 204 ao tile que só tinha o que o aplicativo não desenha", async () => {
    tile.fetchVectorTile.mockResolvedValue({ body: camada("pois", 90) });

    const r = resposta();
    await rota(pedido({ "accept-encoding": "gzip" }), r);

    expect(r.statusCode).toBe(204);
    expect(r.corpo).toBeNull();
    expect(r.headers["Content-Encoding"]).toBeUndefined();
  });
});
