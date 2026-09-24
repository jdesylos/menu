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

async function findPlace(id) {
  const result = await database.query({
    text: `
      SELECT name, street, hidden_reason, duplicate_of, overrides
      FROM places WHERE id = $1
    ;`,
    values: [id],
  });
  return result.rows[0];
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
  const response = await fetch(`${webserver.origin}/api/v1/suggestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${sessionObject.token}`,
    },
    body: JSON.stringify(body),
  });
  return await response.json();
}

async function review(id, status, sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/suggestions/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${sessionObject.token}`,
    },
    body: JSON.stringify({ status }),
  });
  return { status: response.status, body: await response.json() };
}

describe("PATCH /api/v1/suggestions/[id]", () => {
  // Quem sugere não aceita a própria sugestão.
  test("Default user", async () => {
    const user = await sessionFor();
    const suggestion = await suggest(
      {
        kind: "create",
        changes: {
          name: "Por Conta Própria",
          latitude: -23.55,
          longitude: -46.63,
        },
      },
      user,
    );

    const { status, body } = await review(suggestion.id, "accepted", user);

    expect(status).toBe(403);
    expect(body.action).toBe(
      'Verifique se o seu usuário possui a feature "manage:place"',
    );
  });

  describe("Manager user", () => {
    test("Accepting a new place", async () => {
      const user = await sessionFor();
      const manager = await sessionFor(["admin", "manage:place"]);
      const suggestion = await suggest(
        {
          kind: "create",
          changes: { name: "Lugar Novo", latitude: -23.55, longitude: -46.63 },
        },
        user,
      );

      const { status, body } = await review(suggestion.id, "accepted", manager);

      expect(status).toBe(200);
      expect(body.status).toBe("accepted");
      expect(body.reviewed_by).toBe(manager.user_id);
      expect((await findPlace(body.place_id)).name).toBe("Lugar Novo");
    });

    // A correção vai para a coluna, que é o que a busca e o tile leem, e para
    // `overrides`, que é o que a próxima carga do Overture reaplica.
    test("Accepting a correction", async () => {
      const user = await sessionFor();
      const manager = await sessionFor(["admin", "manage:place"]);
      const placeId = await createPlace("Nome Errado");
      const suggestion = await suggest(
        {
          kind: "update",
          place_id: placeId,
          changes: { name: "Nome Certo", street: "Rua Certa, 10" },
        },
        user,
      );

      const { status } = await review(suggestion.id, "accepted", manager);

      expect(status).toBe(200);
      expect(await findPlace(placeId)).toEqual({
        name: "Nome Certo",
        street: "Rua Certa, 10",
        hidden_reason: null,
        duplicate_of: null,
        overrides: { name: "Nome Certo", street: "Rua Certa, 10" },
      });
    });

    test("Accepting a closed place", async () => {
      const user = await sessionFor();
      const manager = await sessionFor(["admin", "manage:place"]);
      const placeId = await createPlace("Fechou Mesmo");
      const suggestion = await suggest(
        { kind: "close", place_id: placeId },
        user,
      );

      await review(suggestion.id, "accepted", manager);

      expect((await findPlace(placeId)).hidden_reason).toBe("reported_closed");
    });

    test("Accepting a duplicate", async () => {
      const user = await sessionFor();
      const manager = await sessionFor(["admin", "manage:place"]);
      const keptId = await createPlace("King Açai e Batataria");
      const duplicateId = await createPlace("King Restaurante - Itaquera");
      const suggestion = await suggest(
        { kind: "duplicate", place_id: duplicateId, duplicate_of: keptId },
        user,
      );

      await review(suggestion.id, "accepted", manager);

      const duplicate = await findPlace(duplicateId);
      expect(duplicate.hidden_reason).toBe("reported_duplicate");
      expect(duplicate.duplicate_of).toBe(keptId);
    });

    test("Rejecting", async () => {
      const user = await sessionFor();
      const manager = await sessionFor(["admin", "manage:place"]);
      const placeId = await createPlace("Continua Aberto");
      const suggestion = await suggest(
        { kind: "close", place_id: placeId },
        user,
      );

      const { status, body } = await review(suggestion.id, "rejected", manager);

      expect(status).toBe(200);
      expect(body.status).toBe("rejected");
      expect((await findPlace(placeId)).hidden_reason).toBeNull();
    });

    test("Reviewing twice", async () => {
      const user = await sessionFor();
      const manager = await sessionFor(["admin", "manage:place"]);
      const placeId = await createPlace("Revisado Uma Vez");
      const suggestion = await suggest(
        { kind: "close", place_id: placeId },
        user,
      );
      await review(suggestion.id, "rejected", manager);

      const { status, body } = await review(suggestion.id, "accepted", manager);

      expect(status).toBe(400);
      expect(body.message).toBe("Esta sugestão já foi revisada.");
      expect((await findPlace(placeId)).hidden_reason).toBeNull();
    });

    test("With an unknown review", async () => {
      const manager = await sessionFor(["admin", "manage:place"]);

      const { status } = await review(
        "11111111-1111-4111-8111-111111111111",
        "aprovado",
        manager,
      );

      expect(status).toBe(400);
    });

    test("With a suggestion that does not exist", async () => {
      const manager = await sessionFor(["admin", "manage:place"]);

      const { status } = await review(
        "11111111-1111-4111-8111-111111111111",
        "accepted",
        manager,
      );

      expect(status).toBe(404);
    });
  });
});
