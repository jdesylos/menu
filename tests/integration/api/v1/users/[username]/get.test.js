import { version as uuidVersion } from "uuid";
import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createAuthenticatedSession() {
  const reader = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(reader);
  return await orchestrator.createSession(activated);
}

describe("GET /api/v1/users/[username]", () => {
  // Aberta, a rota confirmava a qualquer um se um username existe (200 contra
  // 404) e mostrava as features dele.
  describe("Anonymous user", () => {
    test("With an existing username", async () => {
      await orchestrator.createUser({
        username: "Existente",
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/users/Existente`,
      );

      expect(response.status).toBe(403);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ForbiddenError",
        message: "Você não possui permissão para executar esta ação.",
        action: 'Verifique se o seu usuário possui a feature "read:session"',
        status_code: 403,
      });
    });

    test("With nonexistent username", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/users/UsuarioInexistente`,
      );

      expect(response.status).toBe(403);
    });
  });

  describe("Default user", () => {
    // Sem `features`: a lista é o mapa de privilégios da conta, e um usuário
    // não precisa saber o do outro.
    test("With exact case match", async () => {
      const sessionObject = await createAuthenticatedSession();
      await orchestrator.createUser({
        username: "MesmoCase",
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/users/MesmoCase`,
        { headers: { Cookie: `session_id=${sessionObject.token}` } },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        id: responseBody.id,
        username: "MesmoCase",
        created_at: responseBody.created_at,
        updated_at: responseBody.updated_at,
      });

      expect(uuidVersion(responseBody.id)).toBe(4);
      expect(Date.parse(responseBody.created_at)).not.toBeNaN();
      expect(Date.parse(responseBody.updated_at)).not.toBeNaN();
    });

    test("With case mismatch", async () => {
      const sessionObject = await createAuthenticatedSession();
      await orchestrator.createUser({
        username: "CaseDiferente",
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/users/casediferente`,
        { headers: { Cookie: `session_id=${sessionObject.token}` } },
      );

      expect(response.status).toBe(200);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        id: responseBody.id,
        username: "CaseDiferente",
        created_at: responseBody.created_at,
        updated_at: responseBody.updated_at,
      });
    });

    test("With nonexistent username", async () => {
      const sessionObject = await createAuthenticatedSession();

      const response = await fetch(
        `${webserver.origin}/api/v1/users/UsuarioInexistente`,
        { headers: { Cookie: `session_id=${sessionObject.token}` } },
      );

      expect(response.status).toBe(404);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "NotFoundError",
        message: "O username informado não foi encontrado no sistema.",
        action: "Verifique se o username está digitado corretamente.",
        status_code: 404,
      });
    });
  });
});
