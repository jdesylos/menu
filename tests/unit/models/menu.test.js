import menu from "models/menu.js";
import database from "infra/database.js";
import cdn from "infra/cdn.js";

// Nem o banco nem a borda entram: o banco responde o que o teste disser, na
// ordem em que `create` pergunta, e a borda só anota o que lhe pedem. O que
// se afirma aqui é o que o teste de integração não enxerga — lá não há borda,
// e a purga não faz nada.
jest.mock("infra/database.js", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("infra/cdn.js", () => ({
  __esModule: true,
  default: { forget: jest.fn() },
}));

afterEach(() => {
  jest.resetAllMocks();
});

// O Food Storm de Camburi, como o banco o guarda.
const LUGAR = {
  id: "73f25a66-6052-4c06-a4bf-1ae9b5c2be1d",
  name: "Food Storm",
  latitude: -23.77546,
  longitude: -45.64963,
  hidden_at: null,
};

const CONTA = { id: "0b7d5f0e-6a37-4f43-9d6f-0d3a6a1f7c11" };

function cardapioPara(placeId) {
  return {
    place_id: placeId,
    currency: "BRL",
    sections: [{ title: "Kebabs", items: [{ name: "Kebab de carne" }] }],
  };
}

describe("models/menu.js", () => {
  describe(".create()", () => {
    test("with a valid menu", async () => {
      const guardado = { id: "cardapio-guardado", place_id: LUGAR.id };
      database.query
        // O lugar, que `parseInput` confere por último.
        .mockResolvedValueOnce({ rowCount: 1, rows: [LUGAR] })
        // A gravação.
        .mockImplementationOnce(async () => {
          // Até aqui a borda não foi tocada: apagar antes de gravar deixaria
          // a função refazer o tile ainda sem o cardápio, e guardá-lo assim
          // por mais uma hora.
          expect(cdn.forget).not.toHaveBeenCalled();
          return { rowCount: 1, rows: [{ id: guardado.id }] };
        })
        // A leitura do que gravou.
        .mockResolvedValueOnce({ rowCount: 1, rows: [guardado] });

      const created = await menu.create(CONTA, cardapioPara(LUGAR.id));

      expect(created).toEqual(guardado);
      // Os tiles do lugar, um por zoom em que o aplicativo pede lugares.
      expect(cdn.forget).toHaveBeenCalledTimes(1);
      expect(cdn.forget).toHaveBeenCalledWith([
        "places-14-6114-9306",
        "places-15-12228-18613",
        "places-16-24457-37226",
        "places-17-48915-74452",
        "places-18-97830-148904",
      ]);
    });

    test("with a menu the database refuses", async () => {
      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [LUGAR] })
        .mockRejectedValueOnce(new Error("insert failed"));

      await expect(menu.create(CONTA, cardapioPara(LUGAR.id))).rejects.toThrow(
        "insert failed",
      );

      // Nada foi guardado, então o que a borda tem continua certo.
      expect(cdn.forget).not.toHaveBeenCalled();
    });

    test("with an invalid menu", async () => {
      await expect(
        menu.create(CONTA, { ...cardapioPara(LUGAR.id), currency: "XYZ" }),
      ).rejects.toThrow();

      expect(database.query).not.toHaveBeenCalled();
      expect(cdn.forget).not.toHaveBeenCalled();
    });
  });
});
