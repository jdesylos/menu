import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function sessionFor(features = []) {
  const created = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(created);
  if (features.length > 0) {
    await orchestrator.addFeaturesToUser(activated, features);
  }
  return await orchestrator.createSession(activated);
}

async function suggestPlace(name, sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/suggestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${sessionObject.token}`,
    },
    body: JSON.stringify({
      kind: "create",
      changes: { name, latitude: -23.55, longitude: -46.63 },
    }),
  });
  return await response.json();
}

async function list(sessionObject, query = "") {
  const response = await fetch(
    `${webserver.origin}/api/v1/suggestions${query}`,
    {
      headers: sessionObject
        ? { Cookie: `session_id=${sessionObject.token}` }
        : {},
    },
  );
  return { status: response.status, body: await response.json() };
}

describe("GET /api/v1/suggestions", () => {
  test("Anonymous user", async () => {
    const { status } = await list(null);
    expect(status).toBe(403);
  });

  // Cada um vê as próprias, e não as dos outros.
  test("Default user", async () => {
    const ana = await sessionFor();
    const bruno = await sessionFor();
    await suggestPlace("Lugar da Ana", ana);
    await suggestPlace("Lugar do Bruno", bruno);

    const { status, body } = await list(ana);

    expect(status).toBe(200);
    expect(body.suggestions.map((s) => s.changes.name)).toEqual([
      "Lugar da Ana",
    ]);
  });

  // Quem revisa vê a fila de todo mundo: as pendentes, das mais antigas para
  // as mais novas.
  test("Manager user", async () => {
    const manager = await sessionFor(["admin", "manage:place"]);

    const { status, body } = await list(manager);

    expect(status).toBe(200);
    expect(body.suggestions.map((s) => s.changes.name)).toEqual([
      "Lugar da Ana",
      "Lugar do Bruno",
    ]);
  });

  test("Manager user with a status filter", async () => {
    const manager = await sessionFor(["admin", "manage:place"]);
    await suggestPlace("Lugar Aceito", manager);

    const { body } = await list(manager, "?status=accepted");

    expect(body.suggestions.map((s) => s.changes.name)).toEqual([
      "Lugar Aceito",
    ]);
  });

  test("With an unknown status", async () => {
    const manager = await sessionFor(["admin", "manage:place"]);

    const { status } = await list(manager, "?status=aprovado");

    expect(status).toBe(400);
  });
});
