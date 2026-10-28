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
                id: expect.any(String),
                name: "Virado à paulista",
                ingredients: "arroz, tutu, bisteca, couve e ovo",
                price_cents: 4200,
              },
              {
                id: expect.any(String),
                name: "Feijoada completa",
                ingredients: null,
                price_cents: 5800,
              },
            ],
          },
          {
            title: "Bebidas",
            items: [
              {
                id: expect.any(String),
                name: "Caldo de cana",
                ingredients: null,
                price_cents: null,
              },
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
            {
              id: expect.any(String),
              name: "Pastel de feira",
              ingredients: null,
              price_cents: null,
            },
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
    // Qualquer conta manda cardápio, e o mais recente é o que vale: sem a
    // trava, um POST trocava o preço de qualquer lugar do mapa.
    test("With a place that already has a menu", async () => {
      const placeId = await createPlace("Bar que Já Tem");
      const first = await send(menuFor(placeId), await sessionFor());
      expect(first.status).toBe(201);

      const { status, body } = await send(menuFor(placeId), await sessionFor());

      expect(status).toBe(400);
      expect(body).toEqual({
        name: "ValidationError",
        message: "Este lugar já tem cardápio.",
        action: "Abra o cardápio dele pelo mapa.",
        status_code: 400,
      });
      const stored = await database.query({
        text: "SELECT count(*)::int AS total FROM menus WHERE place_id = $1;",
        values: [placeId],
      });
      expect(stored.rows[0].total).toBe(1);
    });

    // Dez por hora, por conta — e não por IP: o teste roda em localhost, que o
    // limite por IP deixa passar, e é a conta que se quer conter.
    test("Past the limit of the account", async () => {
      const sessionObject = await sessionFor();
      for (let i = 0; i < 10; i++) {
        const placeId = await createPlace(`Bar do Limite ${i}`);
        const { status } = await send(menuFor(placeId), sessionObject);
        expect(status).toBe(201);
      }

      const placeId = await createPlace("Bar do Limite Passado");
      const { status, body } = await send(menuFor(placeId), sessionObject);

      expect(status).toBe(429);
      expect(body.name).toBe("RateLimitError");

      // Outra conta, do mesmo IP, continua mandando.
      const other = await send(menuFor(placeId), await sessionFor());
      expect(other.status).toBe(201);
    });

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

  // Trocar o cardápio que vale: quem mandou muda o texto de onde estiver, e
  // qualquer conta troca tudo fotografando no lugar — ver `menu.create`.
  describe("Replacing the menu of a place", () => {
    // A uns `meters` ao norte do ponto dos lugares de `createPlace`.
    function northOf(meters, accuracy_m = 10) {
      return {
        latitude: -23.5505 + meters / 111_195,
        longitude: -46.6333,
        accuracy_m,
      };
    }

    // O cardápio que vale, como o aplicativo o lê para editar.
    async function current(placeId) {
      const response = await fetch(
        `${webserver.origin}/api/v1/menus?place_id=${placeId}`,
      );
      return await response.json();
    }

    // O que voltou, com o preço do primeiro prato trocado: o que o aplicativo
    // manda quando quem editou só corrigiu um preço.
    function withNewPrice(found, price_cents) {
      return {
        place_id: found.place_id,
        currency: found.currency,
        replaces: found.id,
        sections: found.sections.map((section, s) => ({
          title: section.title,
          items: section.items.map((item, i) => ({
            ...item,
            price_cents: s === 0 && i === 0 ? price_cents : item.price_cents,
          })),
        })),
      };
    }

    async function storedMenus(placeId) {
      const result = await database.query({
        text: `
          SELECT replaces_menu_id, distance_m
          FROM menus
          WHERE place_id = $1
          ORDER BY created_at
        ;`,
        values: [placeId],
      });
      return result.rows;
    }

    test("By who sent it, changing only the text", async () => {
      const placeId = await createPlace("Bar do Preço Novo");
      const author = await sessionFor();
      const first = await send(menuFor(placeId), author);

      const { status } = await send(
        withNewPrice(await current(placeId), 4500),
        author,
      );

      expect(status).toBe(201);
      const now = await current(placeId);
      expect(now.id).not.toBe(first.body.id);
      expect(now.sections[0].items[0].price_cents).toBe(4500);
      expect(now.sections[0].items[0].name).toBe("Virado à paulista");
      // O anterior fica, e a troca diz de qual saiu — sem distância: ninguém
      // fotografou.
      expect(await storedMenus(placeId)).toEqual([
        { replaces_menu_id: null, distance_m: null },
        { replaces_menu_id: first.body.id, distance_m: null },
      ]);

      const audit = await database.query({
        text: `
          SELECT count(*)::int AS total
          FROM audit_logs
          WHERE action = 'menu.replace' AND actor_user_id = $1
        ;`,
        values: [author.user_id],
      });
      expect(audit.rows[0].total).toBe(1);
    });

    test("By who sent it, leaving an item out", async () => {
      const placeId = await createPlace("Bar do Prato Sumido");
      const author = await sessionFor();
      await send(menuFor(placeId), author);
      const edited = withNewPrice(await current(placeId), 4500);
      edited.sections[0].items.pop();

      const { status, body } = await send(edited, author);

      expect(status).toBe(403);
      expect(body.action).toBe(
        "Para tirar ou acrescentar pratos, fotografe o cardápio no lugar.",
      );
      expect(await storedMenus(placeId)).toHaveLength(1);
    });

    test("By another account, without photographing", async () => {
      const placeId = await createPlace("Bar de Outra Pessoa");
      await send(menuFor(placeId), await sessionFor());

      const { status, body } = await send(
        withNewPrice(await current(placeId), 100),
        await sessionFor(),
      );

      expect(status).toBe(403);
      expect(body.message).toBe(
        "Só quem mandou este cardápio pode mudar o texto dele.",
      );
      expect(await storedMenus(placeId)).toHaveLength(1);
    });

    test("By another account, photographing at the place", async () => {
      const placeId = await createPlace("Bar Fotografado de Novo");
      const first = await send(menuFor(placeId), await sessionFor());

      const { status } = await send(
        {
          place_id: placeId,
          currency: "BRL",
          replaces: first.body.id,
          position: northOf(30),
          sections: [{ title: "Pratos", items: [{ name: "Picanha" }] }],
        },
        await sessionFor(),
      );

      expect(status).toBe(201);
      const now = await current(placeId);
      expect(now.sections).toEqual([
        {
          title: "Pratos",
          items: [
            {
              id: expect.any(String),
              name: "Picanha",
              ingredients: null,
              price_cents: null,
            },
          ],
        },
      ]);
      expect((await storedMenus(placeId))[1]).toEqual({
        replaces_menu_id: first.body.id,
        distance_m: 30,
      });
    });

    test("Photographing away from the place", async () => {
      const placeId = await createPlace("Bar Longe Demais");
      const first = await send(menuFor(placeId), await sessionFor());

      const { status, body } = await send(
        {
          ...menuFor(placeId),
          replaces: first.body.id,
          position: northOf(850),
        },
        await sessionFor(),
      );

      expect(status).toBe(403);
      expect(body.message).toBe("Você está a 850 m deste lugar.");
      expect(await storedMenus(placeId)).toHaveLength(1);
    });

    // Duas trocas do mesmo cardápio: a segunda partiu de um que já não vale.
    test("After someone else replaced it", async () => {
      const placeId = await createPlace("Bar Trocado Duas Vezes");
      const author = await sessionFor();
      await send(menuFor(placeId), author);
      const read = await current(placeId);

      const first = await send(withNewPrice(read, 4500), author);
      const second = await send(withNewPrice(read, 4600), author);

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body.name).toBe("ConflictError");
      expect((await current(placeId)).sections[0].items[0].price_cents).toBe(
        4500,
      );
    });
  });
});
