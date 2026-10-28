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

  // A troca do cardápio que vale. O banco responde, na ordem: o lugar, o
  // cardápio substituído, a gravação e a leitura do que gravou.
  describe(".create() replacing the menu of a place", () => {
    const PRATO_1 = "8d1f6a2e-3b4c-4d5e-9f60-718293a4b5c6";
    const PRATO_2 = "9e2a7b3f-4c5d-4e6f-8a71-829304b5c6d7";
    const AUTORA = { id: CONTA.id, features: ["create:menu"] };
    const OUTRA = {
      id: "5e0f3c2a-9d1b-4c7e-8a6f-2b4d6e8f0a1c",
      features: ["create:menu"],
    };

    const BASE = {
      id: "2c4e6a8b-0d1f-4a3b-8c5d-6e7f8a9b0c1d",
      place_id: LUGAR.id,
      created_by: CONTA.id,
      currency: "BRL",
      sections: [
        {
          title: "Kebabs",
          items: [
            {
              id: PRATO_1,
              name: "Kebab de carne",
              ingredients: null,
              price_cents: 3000,
            },
            {
              id: PRATO_2,
              name: "Kebab de frango",
              ingredients: null,
              price_cents: 2800,
            },
          ],
        },
      ],
    };

    // Os dois pratos de antes, com o preço do primeiro corrigido.
    function corrigido(extra = {}) {
      return {
        place_id: LUGAR.id,
        currency: "BRL",
        replaces: BASE.id,
        sections: [
          {
            title: "Kebabs",
            items: [
              { id: PRATO_1, name: "Kebab de carne", price_cents: 3200 },
              { id: PRATO_2, name: "Kebab de frango", price_cents: 2800 },
            ],
          },
        ],
        ...extra,
      };
    }

    // A posição a uns `metros` ao norte do ponto do lugar — um grau de
    // latitude tem uns 111,2 km.
    function aoNorte(metros, accuracy_m = 10) {
      return {
        latitude: LUGAR.latitude + metros / 111_195,
        longitude: LUGAR.longitude,
        accuracy_m,
      };
    }

    const guardado = {
      id: "3d5f7b9c-1e2a-4b4c-9d6e-7f8a9b0c1d2e",
      replaces_menu_id: BASE.id,
    };

    // O banco do caminho inteiro. Devolve as mensagens que a gravação
    // recebeu, para o teste conferir o que foi gravado.
    function bancoQueGrava({ gravou = true } = {}) {
      const gravacoes = [];
      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [LUGAR] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [BASE] })
        .mockImplementationOnce(async (query) => {
          gravacoes.push(query.values);
          return gravou
            ? { rowCount: 1, rows: [{ id: guardado.id }] }
            : { rowCount: 0, rows: [] };
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [guardado] });
      return gravacoes;
    }

    function bancoQueRecusa() {
      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [LUGAR] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [BASE] });
    }

    test("by who sent it, changing only the text", async () => {
      const gravacoes = bancoQueGrava();

      const created = await menu.create(AUTORA, corrigido());

      expect(created).toEqual(guardado);
      // De qual saiu, e sem distância: ninguém fotografou.
      expect(gravacoes[0][5]).toBe(BASE.id);
      expect(gravacoes[0][6]).toBeNull();
      // A troca não muda o `has_menu` do tile.
      expect(cdn.forget).not.toHaveBeenCalled();
    });

    test("by who sent it, leaving an item out", async () => {
      bancoQueRecusa();
      const semUm = corrigido();
      semUm.sections[0].items.pop();

      await expect(menu.create(AUTORA, semUm)).rejects.toMatchObject({
        name: "ForbiddenError",
        message:
          "Sem fotografar, só se muda o texto dos pratos que já estão no cardápio.",
      });
      expect(database.query).toHaveBeenCalledTimes(2);
    });

    test("by who sent it, adding an item", async () => {
      bancoQueRecusa();
      const comUmNovo = corrigido();
      comUmNovo.sections[0].items.push({ name: "Falafel" });

      await expect(menu.create(AUTORA, comUmNovo)).rejects.toMatchObject({
        name: "ForbiddenError",
      });
      expect(database.query).toHaveBeenCalledTimes(2);
    });

    test("by another account, without photographing", async () => {
      bancoQueRecusa();

      await expect(menu.create(OUTRA, corrigido())).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "Só quem mandou este cardápio pode mudar o texto dele.",
      });
      expect(database.query).toHaveBeenCalledTimes(2);
    });

    // Fotografando no lugar vale tudo: o cardápio lido do zero não tem os
    // pratos de antes, e pode não ter nenhum deles.
    test("by another account, photographing at the place", async () => {
      const gravacoes = bancoQueGrava();

      await menu.create(OUTRA, {
        ...cardapioPara(LUGAR.id),
        replaces: BASE.id,
        position: aoNorte(50),
      });

      expect(gravacoes[0][5]).toBe(BASE.id);
      expect(gravacoes[0][6]).toBe(50);
      expect(cdn.forget).not.toHaveBeenCalled();
    });

    test("photographing away from the place", async () => {
      bancoQueRecusa();

      await expect(
        menu.create(OUTRA, {
          ...cardapioPara(LUGAR.id),
          replaces: BASE.id,
          position: aoNorte(2100),
        }),
      ).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "Você está a 2,1 km deste lugar.",
      });
      expect(database.query).toHaveBeenCalledTimes(2);
    });

    // 150 m do ponto, com 60 m de erro: pode estar a 90 m, e o erro conta a
    // favor de quem está lá.
    test("photographing with the error of the GPS in favor", async () => {
      const gravacoes = bancoQueGrava();

      await menu.create(OUTRA, {
        ...cardapioPara(LUGAR.id),
        replaces: BASE.id,
        position: aoNorte(150, 60),
      });

      expect(gravacoes[0][6]).toBe(150);
    });

    // A localização aproximada do Android: com 2 km de erro, qualquer um
    // estaria no raio.
    test("photographing with an imprecise position", async () => {
      bancoQueRecusa();

      await expect(
        menu.create(OUTRA, {
          ...cardapioPara(LUGAR.id),
          replaces: BASE.id,
          position: aoNorte(0, 2000),
        }),
      ).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "A localização do aparelho não está precisa o bastante.",
      });
    });

    test("after someone else replaced it", async () => {
      bancoQueGrava({ gravou: false });

      await expect(menu.create(AUTORA, corrigido())).rejects.toMatchObject({
        name: "ConflictError",
        statusCode: 409,
      });
    });

    test("with the menu of another place", async () => {
      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [LUGAR] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...BASE, place_id: "outro-lugar" }],
        });

      await expect(menu.create(AUTORA, corrigido())).rejects.toMatchObject({
        name: "NotFoundError",
      });
    });

    test("with an item that is not in it", async () => {
      bancoQueRecusa();
      const estranho = corrigido();
      estranho.sections[0].items[1].id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

      await expect(menu.create(AUTORA, estranho)).rejects.toMatchObject({
        name: "ValidationError",
      });
    });

    test("with the same item twice", async () => {
      const repetido = corrigido();
      repetido.sections[0].items[1].id = PRATO_1;

      await expect(menu.create(AUTORA, repetido)).rejects.toMatchObject({
        name: "ValidationError",
        message: "Dois pratos vieram com o mesmo id.",
      });
      expect(database.query).not.toHaveBeenCalled();
    });

    // Sem `replaces`, é o primeiro cardápio do lugar: posição e `id` de prato
    // não têm o que dizer, e calá-los diria "ok" a um pedido mal montado.
    test("with a position, but nothing to replace", async () => {
      await expect(
        menu.create(AUTORA, {
          ...cardapioPara(LUGAR.id),
          position: aoNorte(10),
        }),
      ).rejects.toMatchObject({
        name: "ValidationError",
        message: "A posição só vale para trocar um cardápio.",
      });
      expect(database.query).not.toHaveBeenCalled();
    });

    test("with an item id, but nothing to replace", async () => {
      const { replaces, ...semReplaces } = corrigido();
      expect(replaces).toBe(BASE.id);

      await expect(menu.create(AUTORA, semReplaces)).rejects.toMatchObject({
        name: "ValidationError",
        message: "Campo desconhecido no prato: id.",
      });
      expect(database.query).not.toHaveBeenCalled();
    });
  });

  describe(".canEditText()", () => {
    const cardapio = { id: "cardapio-do-lugar", created_by: CONTA.id };

    test("by who sent it", () => {
      const quemMandou = { id: CONTA.id, features: ["create:menu"] };

      expect(menu.canEditText(quemMandou, cardapio)).toBe(true);
    });

    test("by another account", () => {
      const outra = {
        id: "5e0f3c2a-9d1b-4c7e-8a6f-2b4d6e8f0a1c",
        features: ["create:menu"],
      };

      expect(menu.canEditText(outra, cardapio)).toBe(false);
    });

    // A sessão anônima não tem id: `undefined === undefined` não pode virar
    // permissão num cardápio que viesse sem autor.
    test("without session", () => {
      const anonima = { features: ["create:session"] };

      expect(menu.canEditText(anonima, cardapio)).toBe(false);
      expect(menu.canEditText(anonima, { id: "sem-autor" })).toBe(false);
    });

    test("by who sent it, without the feature", () => {
      const presa = { id: CONTA.id, features: ["read:user:self"] };

      expect(menu.canEditText(presa, cardapio)).toBe(false);
    });
  });
});
