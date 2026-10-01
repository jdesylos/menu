import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createPlace(name, { hidden = false } = {}) {
  const result = await database.query({
    text: `
      INSERT INTO places
        (source, source_id, name, latitude, longitude, hidden_at, hidden_reason)
      VALUES
        ('overture', $1, $1, -23.5505, -46.6333, $2, $3)
      RETURNING id
    ;`,
    values: [name, hidden ? new Date() : null, hidden ? "closed" : null],
  });
  return result.rows[0].id;
}

async function sessionFor(features = []) {
  const created = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(created);
  if (features.length > 0) {
    await orchestrator.addFeaturesToUser(activated, features);
  }
  return await orchestrator.createSession(activated);
}

async function send(body, sessionObject) {
  const headers = { "Content-Type": "application/json" };
  if (sessionObject) {
    headers.Cookie = `session_id=${sessionObject.token}`;
  }
  const response = await fetch(`${webserver.origin}/api/v1/menus`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function menuFor(placeId) {
  return {
    place_id: placeId,
    currency: "BRL",
    sections: [
      {
        title: "Pratos",
        items: [
          {
            name: "Virado à paulista",
            ingredients: "arroz, tutu, bisteca, couve e ovo",
            price_cents: 4200,
          },
          { name: "Feijoada completa", price_cents: 5800 },
        ],
      },
      {
        title: "Bebidas",
        items: [{ name: "Caldo de cana" }],
      },
    ],
  };
}

describe("POST /api/v1/menus", () => {
  describe("Anonymous user", () => {
    test("With a valid menu", async () => {
      const placeId = await createPlace("Bar Anônimo");
      const { status, body } = await send(menuFor(placeId));

      expect(status).toBe(403);
      expect(body.action).toBe(
        'Verifique se o seu usuário possui a feature "create:menu"',
      );
    });
  });

  describe("Default user", () => {
    test("With a valid menu", async () => {
      const placeId = await createPlace("Bar do Cardápio");
      const sessionObject = await sessionFor();

      const { status, body } = await send(menuFor(placeId), sessionObject);

      expect(status).toBe(201);
      expect(body).toEqual({
        id: expect.any(String),
        place_id: placeId,
        currency: "BRL",
        created_at: expect.any(String),
        sections: [
          {
            title: "Pratos",
            items: [
              {
                name: "Virado à paulista",
                ingredients: "arroz, tutu, bisteca, couve e ovo",
                price_cents: 4200,
              },
              {
                name: "Feijoada completa",
                ingredients: null,
                price_cents: 5800,
              },
            ],
          },
          {
            title: "Bebidas",
            items: [
              { name: "Caldo de cana", ingredients: null, price_cents: null },
            ],
          },
        ],
      });

      // Quem mandou fica no banco, e não sai na resposta.
      const stored = await database.query({
        text: "SELECT created_by FROM menus WHERE id = $1;",
        values: [body.id],
      });
      expect(stored.rows[0].created_by).toBe(sessionObject.user_id);
    });

    test("Trims the text, and stores an empty description as none", async () => {
      const placeId = await createPlace("Bar dos Espaços");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        {
          place_id: placeId,
          currency: "BRL",
          sections: [
            {
              title: "  Lanches  ",
              items: [{ name: "  Pastel de feira ", ingredients: "   " }],
            },
          ],
        },
        sessionObject,
      );

      expect(status).toBe(201);
      expect(body.sections).toEqual([
        {
          title: "Lanches",
          items: [
            { name: "Pastel de feira", ingredients: null, price_cents: null },
          ],
        },
      ]);
    });

    test("With a section without title", async () => {
      const placeId = await createPlace("Bar sem Cabeçalho");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        {
          place_id: placeId,
          currency: "BRL",
          sections: [{ items: [{ name: "Coxinha", price_cents: 900 }] }],
        },
        sessionObject,
      );

      expect(status).toBe(201);
      expect(body.sections[0].title).toBe("");
    });

    test("Without the feature", async () => {
      const placeId = await createPlace("Bar da Conta Presa");
      const created = await orchestrator.createUser();
      const sessionObject = await orchestrator.createSession(created);

      const { status } = await send(menuFor(placeId), sessionObject);

      expect(status).toBe(403);
    });

    test("With a place that does not exist", async () => {
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        menuFor("7c9a0e52-6f0f-4b3e-9d57-3f6d1a2b4c5d"),
        sessionObject,
      );

      expect(status).toBe(404);
      expect(body.message).toBe("O lugar informado não foi encontrado.");
    });

    test("With a hidden place", async () => {
      const placeId = await createPlace("Bar que Fechou", { hidden: true });
      const sessionObject = await sessionFor();

      const { status, body } = await send(menuFor(placeId), sessionObject);

      expect(status).toBe(404);
      expect(body.message).toBe("O lugar informado não está mais no mapa.");
    });

    test("Without any item", async () => {
      const placeId = await createPlace("Bar Vazio");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        {
          place_id: placeId,
          currency: "BRL",
          sections: [{ title: "Pratos", items: [] }],
        },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.message).toBe("O cardápio não tem nenhum prato.");
    });

    test("With an item without name", async () => {
      const placeId = await createPlace("Bar sem Nome");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        {
          place_id: placeId,
          currency: "BRL",
          sections: [{ title: "Pratos", items: [{ name: "  " }] }],
        },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.message).toBe("Um dos pratos está sem nome.");
    });

    // O preço em reais mandado no lugar dos centavos: arredondar esconderia o
    // engano, e R$ 42,50 viraria R$ 0,42.
    test("With a price that is not in cents", async () => {
      const placeId = await createPlace("Bar do Preço Quebrado");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        {
          place_id: placeId,
          currency: "BRL",
          sections: [
            {
              title: "Pratos",
              items: [{ name: "Moqueca", price_cents: 42.5 }],
            },
          ],
        },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.message).toBe('O preço "42.5" não é um valor em centavos.');
    });

    test("With an unknown currency", async () => {
      const placeId = await createPlace("Bar da Moeda Errada");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        { ...menuFor(placeId), currency: "R$" },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.action).toBe("Use uma destas: BRL, USD, EUR.");
    });

    test("With an unknown field", async () => {
      const placeId = await createPlace("Bar do Campo a Mais");
      const sessionObject = await sessionFor();

      const { status, body } = await send(
        { ...menuFor(placeId), restaurant: "Bar do Campo a Mais" },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.message).toBe("Campo desconhecido no cardápio: restaurant.");
    });

    // Um cardápio que não passa não deixa metade dele no banco.
    test("A rejected menu leaves nothing behind", async () => {
      const placeId = await createPlace("Bar do Meio Caminho");
      const sessionObject = await sessionFor();

      await send(
        {
          place_id: placeId,
          currency: "BRL",
          sections: [
            { title: "Pratos", items: [{ name: "Feijoada" }] },
            { title: "Bebidas", items: [{ name: "" }] },
          ],
        },
        sessionObject,
      );

      const stored = await database.query({
        text: "SELECT count(*)::int AS total FROM menus WHERE place_id = $1;",
        values: [placeId],
      });
      expect(stored.rows[0].total).toBe(0);
    });
  });
});
