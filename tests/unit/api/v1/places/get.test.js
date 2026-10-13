import rota from "pages/api/v1/places/[z]/[x]/[y].js";
import place from "models/place.js";

// O banco não entra: o modelo devolve os lugares que o teste disser, e o
// resto dele é o de verdade. O que se afirma é o que a ROTA escreve para a
// borda — e a borda só existe na Vercel, onde o teste de integração não roda.
jest.mock("models/place.js", () => {
  const { default: real } = jest.requireActual("models/place.js");
  return {
    __esModule: true,
    default: { ...real, findWithinTile: jest.fn() },
  };
});

afterEach(() => {
  jest.resetAllMocks();
});

function pedido(z, x, y) {
  return {
    method: "GET",
    url: `/api/v1/places/${z}/${x}/${y}`,
    query: { z, x, y },
    headers: {},
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

describe("GET /api/v1/places/[z]/[x]/[y]", () => {
  test("etiqueta a resposta com o tile, para a borda poder apagá-la", async () => {
    place.findWithinTile.mockResolvedValue([]);

    const r = resposta();
    await rota(pedido("16", "24457", "37226"), r);

    expect(r.statusCode).toBe(200);
    expect(r.headers["Cache-Control"]).toContain("s-maxage=3600");
    expect(r.headers["Vercel-Cache-Tag"]).toBe("places-16-24457-37226");
  });

  // A etiqueta é uma das que o cardápio novo do lugar apaga — senão a purga
  // erraria o tile, e o marcador seguiria sem cor.
  test("usa a etiqueta que o cardápio de um lugar do tile apaga", async () => {
    place.findWithinTile.mockResolvedValue([]);
    // O Food Storm de Camburi, que fica neste tile.
    const doLugar = place.cacheTagsOf({
      latitude: -23.77546,
      longitude: -45.64963,
    });

    for (const [z, x, y] of [
      ["14", "6114", "9306"],
      ["16", "24457", "37226"],
      ["18", "97830", "148904"],
    ]) {
      const r = resposta();
      await rota(pedido(z, x, y), r);

      expect(doLugar).toContain(r.headers["Vercel-Cache-Tag"]);
    }
  });

  test("não etiqueta o pedido recusado", async () => {
    const r = resposta();
    await rota(pedido("13", "0", "0"), r);

    expect(r.statusCode).toBe(400);
    expect(r.headers["Vercel-Cache-Tag"]).toBeUndefined();
    expect(place.findWithinTile).not.toHaveBeenCalled();
  });
});
