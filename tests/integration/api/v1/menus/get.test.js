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
      INSERT INTO places (source, source_id, name, latitude, longitude)
      VALUES ('overture', $1, $1, -23.5505, -46.6333)
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

async function send(placeId, itemName, sessionObject) {
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
        { title: "Pratos", items: [{ name: itemName, price_cents: 3500 }] },
      ],
    }),
  });
  expect(response.status).toBe(201);
  return await response.json();
}

async function read(placeId) {
  const response = await fetch(
    `${webserver.origin}/api/v1/menus?place_id=${encodeURIComponent(placeId)}`,
  );
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

describe("GET /api/v1/menus", () => {
  describe("Anonymous user", () => {
    test("With a place that has a menu", async () => {
      const placeId = await createPlace("Bar com Cardápio");
      const sessionObject = await sessionForActivatedUser();
      const sent = await send(placeId, "Parmegiana", sessionObject);

      const { status, body, cacheControl } = await read(placeId);

      expect(status).toBe(200);
      expect(body).toEqual({
        id: sent.id,
        place_id: placeId,
        currency: "BRL",
        created_at: sent.created_at,
        sections: [
          {
            title: "Pratos",
            items: [
              { name: "Parmegiana", ingredients: null, price_cents: 3500 },
            ],
          },
        ],
      });
      // Quem acabou de mandar espera ver o que mandou.
      expect(cacheControl).toContain("no-store");
    });

    // Cada envio é um cardápio novo, e o que vale é o mais recente.
    test("With a place that received two menus", async () => {
      const placeId = await createPlace("Bar que Mudou o Cardápio");
      const sessionObject = await sessionForActivatedUser();
      await send(placeId, "Prato antigo", sessionObject);
      const newest = await send(placeId, "Prato novo", sessionObject);

      const { status, body } = await read(placeId);

      expect(status).toBe(200);
      expect(body.id).toBe(newest.id);
      expect(body.sections[0].items[0].name).toBe("Prato novo");

      // O anterior continua guardado: é o registro de quem mandou o quê.
      const stored = await database.query({
        text: "SELECT count(*)::int AS total FROM menus WHERE place_id = $1;",
        values: [placeId],
      });
      expect(stored.rows[0].total).toBe(2);
    });

    test("With a place that has no menu", async () => {
      const placeId = await createPlace("Bar sem Cardápio");

      const { status, body } = await read(placeId);

      expect(status).toBe(404);
      expect(body.message).toBe("Este lugar ainda não tem cardápio.");
    });

    test("With a place that does not exist", async () => {
      const { status, body } = await read(
        "7c9a0e52-6f0f-4b3e-9d57-3f6d1a2b4c5d",
      );

      expect(status).toBe(404);
      expect(body.message).toBe("O lugar informado não foi encontrado.");
    });

    test("Without a place", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/menus`);

      expect(response.status).toBe(404);
    });
  });
});
