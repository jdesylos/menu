import placeSuggestion from "models/placeSuggestion.js";
import database from "infra/database.js";
import cdn from "infra/cdn.js";

// Nem o banco nem a borda entram, como no teste do cardápio: o banco responde
// o que o teste disser, na ordem em que `review` pergunta, e a borda só anota
// o que lhe pedem. O teste de integração não enxerga a purga — lá não há
// borda, e ela não faz nada.
jest.mock("infra/database.js", () => ({
  __esModule: true,
  default: { getNewClient: jest.fn() },
}));
jest.mock("infra/cdn.js", () => ({
  __esModule: true,
  default: { forget: jest.fn() },
}));

afterEach(() => {
  jest.resetAllMocks();
});

const QUEM_REVISA = { id: "5c1e0a3d-8f2b-4a6e-9d71-3b0f6c2e8a14" };

// O Queijo e Carne Burger e o Brasil Burguer, na Raul Saddi, 66, no Butantã,
// e a SofMar Confeitaria, uns 15 m ao norte — já no tile de cima em z16.
const RAUL_SADDI_66 = { latitude: -23.56916, longitude: -46.71323 };
const SOFMAR = { latitude: -23.56902, longitude: -46.71323 };

const TILES_DA_RAUL_SADDI_66 = [
  "places-14-6066-9296",
  "places-15-12132-18592",
  "places-16-24264-37185",
  "places-17-48528-74370",
  "places-18-97056-148740",
];

// Uma conexão que responde, em ordem, o que o teste lhe der — sem contar a
// abertura e o fim da transação, que não devolvem nada que `review` leia.
// No COMMIT a borda ainda não pode ter sido tocada: apagar antes de gravar
// deixaria a função refazer o tile sem a mudança, e guardá-lo assim por mais
// uma hora.
function conexaoQueResponde(respostas) {
  const client = {
    end: jest.fn(),
    query: jest.fn(async (query) => {
      if (query === "BEGIN" || query === "ROLLBACK") {
        return {};
      }
      if (query === "COMMIT") {
        expect(cdn.forget).not.toHaveBeenCalled();
        return {};
      }
      const resposta = respostas.shift();
      if (resposta instanceof Error) {
        throw resposta;
      }
      return resposta;
    }),
  };
  database.getNewClient.mockResolvedValue(client);
  return client;
}

function sugestao(campos) {
  return {
    id: "fd17c167-f612-4f37-bfbd-fb4f8e38e549",
    place_id: null,
    duplicate_of: null,
    changes: {},
    status: "pending",
    ...campos,
  };
}

function linha(rows) {
  return { rowCount: rows.length, rows };
}

describe("models/placeSuggestion.js", () => {
  describe(".review()", () => {
    test("accepting a new place", async () => {
      const pedido = sugestao({
        kind: "create",
        changes: { name: "Queijo e Carne Burger", ...RAUL_SADDI_66 },
      });
      const revisada = { ...pedido, status: "accepted" };
      const client = conexaoQueResponde([
        linha([pedido]),
        // O lugar que nasce.
        linha([
          { id: "27bdd19d-0f4c-4348-af8a-fe5589cab839", ...RAUL_SADDI_66 },
        ]),
        linha([revisada]),
      ]);

      const resultado = await placeSuggestion.review(
        QUEM_REVISA,
        pedido.id,
        "accepted",
      );

      expect(resultado).toEqual(revisada);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(cdn.forget).toHaveBeenCalledTimes(1);
      expect(cdn.forget).toHaveBeenCalledWith(TILES_DA_RAUL_SADDI_66);
    });

    test("accepting a close", async () => {
      const pedido = sugestao({
        kind: "close",
        place_id: "87fa1a04-f1c0-4842-9ece-6eb81836651c",
      });
      conexaoQueResponde([
        linha([pedido]),
        // O lugar ocultado, que continua onde estava.
        linha([RAUL_SADDI_66]),
        linha([{ ...pedido, status: "accepted" }]),
      ]);

      await placeSuggestion.review(QUEM_REVISA, pedido.id, "accepted");

      expect(cdn.forget).toHaveBeenCalledTimes(1);
      expect(cdn.forget).toHaveBeenCalledWith(TILES_DA_RAUL_SADDI_66);
    });

    // O lugar sai de um tile e entra no outro, e os dois mudam. Em z14 e z15
    // as duas posições caem no mesmo tile, e a etiqueta vai uma vez só.
    test("accepting a correction that moves the place", async () => {
      const pedido = sugestao({
        kind: "update",
        place_id: "88e10183-cc0f-4767-adf1-c479eab8abfb",
        changes: SOFMAR,
      });
      conexaoQueResponde([
        linha([pedido]),
        // Onde estava, e onde ficou.
        linha([RAUL_SADDI_66]),
        linha([SOFMAR]),
        linha([{ ...pedido, status: "accepted" }]),
      ]);

      await placeSuggestion.review(QUEM_REVISA, pedido.id, "accepted");

      expect(cdn.forget).toHaveBeenCalledTimes(1);
      expect(cdn.forget).toHaveBeenCalledWith([
        ...TILES_DA_RAUL_SADDI_66,
        "places-16-24264-37184",
        "places-17-48528-74369",
        "places-18-97056-148739",
      ]);
    });

    // Recusar não muda o mapa, então o que a borda tem continua certo.
    test("rejecting", async () => {
      const pedido = sugestao({
        kind: "create",
        changes: { name: "Queijo e Carne Burger", ...RAUL_SADDI_66 },
      });
      conexaoQueResponde([
        linha([pedido]),
        linha([{ ...pedido, status: "rejected" }]),
      ]);

      await placeSuggestion.review(QUEM_REVISA, pedido.id, "rejected");

      expect(cdn.forget).not.toHaveBeenCalled();
    });

    // Nada foi guardado, então a borda também fica como estava.
    test("when the database refuses the change", async () => {
      const pedido = sugestao({
        kind: "create",
        changes: { name: "Queijo e Carne Burger", ...RAUL_SADDI_66 },
      });
      const client = conexaoQueResponde([
        linha([pedido]),
        new Error("insert failed"),
      ]);

      await expect(
        placeSuggestion.review(QUEM_REVISA, pedido.id, "accepted"),
      ).rejects.toThrow("insert failed");

      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.query).not.toHaveBeenCalledWith("COMMIT");
      expect(cdn.forget).not.toHaveBeenCalled();
    });
  });
});
