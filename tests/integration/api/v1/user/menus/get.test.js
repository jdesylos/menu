import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createPlace(name) {
  const result = await database.query({
    text: `
      INSERT INTO places
        (source, source_id, name, latitude, longitude, street)
      VALUES
        ('overture', $1, $1, -23.5505, -46.6333, 'Rua do Teste, 10')
      RETURNING id
    ;`,
    values: [name],
  });
  return result.rows[0].id;
}

async function sessionForActivatedUser() {
  const created = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(created);
  return await orchestrator.createSession(activated);
}

async function send(placeId, itemNames, sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/menus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${sessionObject.token}`,
    },
    body: JSON.stringify({
      place_id: placeId,
      currency: "BRL",
      sections: [
        { title: "Pratos", items: itemNames.map((name) => ({ name })) },
      ],
    }),
  });
  expect(response.status).toBe(201);
  return await response.json();
}

async function mine(sessionToken) {
  const headers = {};
  if (sessionToken) {
    headers.Cookie = `session_id=${sessionToken}`;
  }
  const response = await fetch(`${webserver.origin}/api/v1/user/menus`, {
    headers,
  });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

describe("GET /api/v1/user/menus", () => {
  describe("Anonymous user", () => {
    test("Without a session", async () => {
      const { status, body } = await mine(null);

      expect(status).toBe(403);
      expect(body).toEqual({
        name: "ForbiddenError",
        message: "Você não possui permissão para executar esta ação.",
        action: 'Verifique se o seu usuário possui a feature "read:session"',
        status_code: 403,
      });
    });

    // Para o aplicativo, 401 é a sessão morta — e ele a esquece.
    test("With a nonexistent session", async () => {
      const { status, body } = await mine(
        "f0b62a5ff97ae607701ceeee2e3c4987c4b9debb534410e2444f9eb2288b6e3b90158a71d086e31eabef9b36cbb549e1",
      );

      expect(status).toBe(401);
      expect(body.name).toBe("UnauthorizedError");
    });
  });

  describe("Default user", () => {
    test("Without any menu sent", async () => {
      const sessionObject = await sessionForActivatedUser();

      const { status, body } = await mine(sessionObject.token);

      expect(status).toBe(200);
      expect(body).toEqual({ places: [] });
    });

    test("With menus sent by itself and by someone else", async () => {
      const sessionObject = await sessionForActivatedUser();
      const someoneElse = await sessionForActivatedUser();
      const primeiro = await createPlace("Bar do Primeiro Envio");
      const segundo = await createPlace("Bar do Segundo Envio");
      const deOutro = await createPlace("Bar de Outra Pessoa");
      await send(primeiro, ["Prato antigo"], sessionObject);
      await send(deOutro, ["Prato de outra pessoa"], someoneElse);
      const sent = await send(segundo, ["Prato", "Outro prato"], sessionObject);

      const { status, body, cacheControl } = await mine(sessionObject.token);

      expect(status).toBe(200);
      // Só os da conta, do envio mais recente para o mais antigo.
      expect(body.places.map((place) => place.name)).toEqual([
        "Bar do Segundo Envio",
        "Bar do Primeiro Envio",
      ]);
      // A mesma forma da lista de todos — ver `/api/v1/menus/places`.
      expect(body.places[0]).toEqual({
        id: segundo,
        name: "Bar do Segundo Envio",
        category: null,
        latitude: -23.5505,
        longitude: -46.6333,
        street: "Rua do Teste, 10",
        neighborhood: null,
        locality: null,
        region: null,
        postcode: null,
        menu: { id: sent.id, items: 2, created_at: expect.any(String) },
      });
      // Quem acabou de mandar espera ver o lugar na aba.
      expect(cacheControl).toContain("no-store");
    });

    // Um lugar, uma linha: a do último envio da conta para ele. O mais velho
    // entra direto no banco — a rota não aceita mais um segundo cardápio.
    test("With two menus sent to the same place", async () => {
      const sessionObject = await sessionForActivatedUser();
      const placeId = await createPlace("Bar Mandado Duas Vezes");
      const newest = await send(placeId, ["Novo", "Novo 2"], sessionObject);
      await orchestrator.insertMenu({
        placeId,
        userId: sessionObject.user_id,
        itemNames: ["Antigo"],
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      const { body } = await mine(sessionObject.token);

      expect(body.places).toHaveLength(1);
      expect(body.places[0].menu.id).toBe(newest.id);
      expect(body.places[0].menu.items).toBe(2);
    });

    // Outra pessoa mandou depois — antes da trava, ou quando atualizar voltar
    // a existir: o lugar continua na aba, com o que a conta mandou, e não com
    // o cardápio que vale agora.
    test("With a menu sent later by someone else", async () => {
      const sessionObject = await sessionForActivatedUser();
      const someoneElse = await sessionForActivatedUser();
      const placeId = await createPlace("Bar que Outra Pessoa Atualizou");
      const own = await send(placeId, ["Meu prato"], sessionObject);
      await orchestrator.insertMenu({
        placeId,
        userId: someoneElse.user_id,
        itemNames: ["Prato novo", "Outro novo"],
        createdAt: new Date(Date.now() + 60 * 1000),
      });

      const { body } = await mine(sessionObject.token);

      expect(body.places).toHaveLength(1);
      expect(body.places[0].menu.id).toBe(own.id);
      expect(body.places[0].menu.items).toBe(1);
    });

    // O lugar oculto saiu do mapa, e sai da aba junto — o cardápio continua
    // guardado.
    test("With a hidden place", async () => {
      const sessionObject = await sessionForActivatedUser();
      const visivel = await createPlace("Bar que Continua");
      const oculto = await createPlace("Bar que Fechou");
      await send(oculto, ["Último prato"], sessionObject);
      await send(visivel, ["Prato"], sessionObject);
      await database.query({
        text: `
          UPDATE places
          SET hidden_at = now(), hidden_reason = 'closed'
          WHERE id = $1
        ;`,
        values: [oculto],
      });

      const { body } = await mine(sessionObject.token);

      expect(body.places.map((place) => place.id)).toEqual([visivel]);
    });
  });
});
