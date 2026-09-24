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

async function sessionFor(features = []) {
  const created = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(created);
  if (features.length > 0) {
    await orchestrator.addFeaturesToUser(activated, features);
  }
  return await orchestrator.createSession(activated);
}

async function suggest(body, sessionObject) {
  const headers = { "Content-Type": "application/json" };
  if (sessionObject) {
    headers.Cookie = `session_id=${sessionObject.token}`;
  }
  const response = await fetch(`${webserver.origin}/api/v1/suggestions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function searchNames(term) {
  const response = await fetch(
    `${webserver.origin}/api/v1/places?q=${encodeURIComponent(term)}`,
  );
  const body = await response.json();
  return body.places.map((p) => p.name);
}

const TIA_LOURDES = {
  name: "Restaurante Tia Lourdes",
  category: "brazilian_restaurant",
  latitude: -23.56895,
  longitude: -46.71486,
  street: "Av. Vital Brasil, 1250 - Loja 5B",
};

describe("POST /api/v1/suggestions", () => {
  describe("Anonymous user", () => {
    test("With a new place", async () => {
      const { status, body } = await suggest({
        kind: "create",
        changes: TIA_LOURDES,
      });

      expect(status).toBe(403);
      expect(body.action).toBe(
        'Verifique se o seu usuário possui a feature "create:place"',
      );
    });
  });

  describe("Default user", () => {
    // Pendente até alguém revisar: o mapa não muda com o pedido.
    test("With a new place", async () => {
      const sessionObject = await sessionFor();

      const { status, body } = await suggest(
        { kind: "create", changes: TIA_LOURDES },
        sessionObject,
      );

      expect(status).toBe(201);
      expect(body).toEqual({
        id: body.id,
        kind: "create",
        place_id: null,
        duplicate_of: null,
        changes: TIA_LOURDES,
        status: "pending",
        created_by: sessionObject.user_id,
        reviewed_by: null,
        reviewed_at: null,
        created_at: body.created_at,
        updated_at: body.updated_at,
      });
      expect(await searchNames("tia lourdes")).toEqual([]);
    });

    test("With a new place without a name", async () => {
      const sessionObject = await sessionFor();

      const { status, body } = await suggest(
        {
          kind: "create",
          changes: { latitude: -23.56, longitude: -46.71 },
        },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.message).toBe('Falta "name" no lugar sugerido.');
    });

    test("With latitude and longitude swapped", async () => {
      const sessionObject = await sessionFor();

      const { status, body } = await suggest(
        {
          kind: "create",
          changes: { name: "Trocado", latitude: -46.71, longitude: -23.56 },
        },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.action).toBe(
        "Confira se latitude e longitude não estão trocadas.",
      );
    });

    // Campo desconhecido é recusado, e não descartado: descartar diria "ok" a
    // um pedido que não foi atendido.
    test("With an unknown field", async () => {
      const sessionObject = await sessionFor();

      const { status, body } = await suggest(
        {
          kind: "create",
          changes: { ...TIA_LOURDES, source: "overture" },
        },
        sessionObject,
      );

      expect(status).toBe(400);
      expect(body.message).toBe('Campo desconhecido em "changes": source.');
    });

    test("With a correction", async () => {
      const sessionObject = await sessionFor();
      const placeId = await createPlace("Bar Errado");

      const { status, body } = await suggest(
        {
          kind: "update",
          place_id: placeId,
          changes: { name: "Bar Certo" },
        },
        sessionObject,
      );

      expect(status).toBe(201);
      expect(body.status).toBe("pending");
      expect(await searchNames("bar errado")).toEqual(["Bar Errado"]);
    });

    test("With a correction that changes nothing", async () => {
      const sessionObject = await sessionFor();
      const placeId = await createPlace("Bar Sem Mudança");

      const { status } = await suggest(
        { kind: "update", place_id: placeId, changes: {} },
        sessionObject,
      );

      expect(status).toBe(400);
    });

    test("With a place that does not exist", async () => {
      const sessionObject = await sessionFor();

      const { status } = await suggest(
        { kind: "close", place_id: "11111111-1111-4111-8111-111111111111" },
        sessionObject,
      );

      expect(status).toBe(404);
    });

    // Sem forma de UUID, o id nem chega ao banco: 404, e não um 500 de
    // sintaxe do Postgres.
    test("With a malformed place id", async () => {
      const sessionObject = await sessionFor();

      const { status } = await suggest(
        { kind: "close", place_id: "nao-e-uuid" },
        sessionObject,
      );

      expect(status).toBe(404);
    });

    test("With a place as a duplicate of itself", async () => {
      const sessionObject = await sessionFor();
      const placeId = await createPlace("Bar Único");

      const { status } = await suggest(
        { kind: "duplicate", place_id: placeId, duplicate_of: placeId },
        sessionObject,
      );

      expect(status).toBe(400);
    });

    test("With an unknown kind", async () => {
      const sessionObject = await sessionFor();

      const { status } = await suggest({ kind: "delete" }, sessionObject);

      expect(status).toBe(400);
    });
  });

  // A sugestão de quem revisa entra aceita, e o mapa muda na hora.
  describe("Manager user", () => {
    test("With a new place", async () => {
      const sessionObject = await sessionFor(["admin", "manage:place"]);

      const { status, body } = await suggest(
        { kind: "create", changes: { ...TIA_LOURDES, name: "Tia Admin" } },
        sessionObject,
      );

      expect(status).toBe(201);
      expect(body.status).toBe("accepted");
      expect(body.reviewed_by).toBe(sessionObject.user_id);
      expect(body.place_id).toEqual(expect.any(String));
      expect(await searchNames("tia admin")).toEqual(["Tia Admin"]);

      const created = await database.query({
        text: "SELECT source, source_id FROM places WHERE id = $1;",
        values: [body.place_id],
      });
      expect(created.rows).toEqual([{ source: "usuario", source_id: body.id }]);
    });
  });

  // `admin` sozinho não concede nada, como no repositório judhagsan: quem tem
  // só o marcador sugere como qualquer um, e a sugestão fica pendente.
  describe("Admin user without manage:place", () => {
    test("With a new place", async () => {
      const sessionObject = await sessionFor(["admin"]);

      const { status, body } = await suggest(
        { kind: "create", changes: { ...TIA_LOURDES, name: "Tia Marcador" } },
        sessionObject,
      );

      expect(status).toBe(201);
      expect(body.status).toBe("pending");
    });
  });
});
