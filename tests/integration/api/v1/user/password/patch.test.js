import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

const CURRENT = "senha-de-antes";
const NEW = "senha-de-depois";

async function activatedUser() {
  const created = await orchestrator.createUser({ password: CURRENT });
  const activated = await orchestrator.activateUser(created);
  const sessionObject = await orchestrator.createSession(activated);
  return { user: activated, sessionObject };
}

async function changePassword(sessionObject, body) {
  const headers = { "Content-Type": "application/json" };
  if (sessionObject) {
    headers.Cookie = `session_id=${sessionObject.token}`;
  }
  const response = await fetch(`${webserver.origin}/api/v1/user/password`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function login(email, password) {
  const response = await fetch(`${webserver.origin}/api/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return response.status;
}

async function whoAmI(sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/user`, {
    headers: { Cookie: `session_id=${sessionObject.token}` },
  });
  return response.status;
}

describe("PATCH /api/v1/user/password", () => {
  describe("Anonymous user", () => {
    test("Without a session", async () => {
      const { status, body } = await changePassword(null, {
        current_password: CURRENT,
        password: NEW,
      });

      expect(status).toBe(403);
      expect(body.name).toBe("ForbiddenError");
    });
  });

  describe("Default user", () => {
    test("With the wrong current password", async () => {
      const { user, sessionObject } = await activatedUser();

      const { status, body } = await changePassword(sessionObject, {
        current_password: "nao-e-esta-senha",
        password: NEW,
      });

      // 400, e não 401: para o aplicativo, 401 é sessão morta.
      expect(status).toBe(400);
      expect(body).toEqual({
        name: "ValidationError",
        message: "A senha atual não confere.",
        action: "Confira a senha atual e tente de novo.",
        status_code: 400,
      });

      // A senha de antes continua valendo, e a sessão também.
      expect(await login(user.email, CURRENT)).toBe(201);
      expect(await login(user.email, NEW)).toBe(401);
      expect(await whoAmI(sessionObject)).toBe(200);
    });

    test("Without the current password", async () => {
      const { sessionObject } = await activatedUser();

      const { status, body } = await changePassword(sessionObject, {
        password: NEW,
      });

      expect(status).toBe(400);
      expect(body.message).toBe("A senha atual não foi informada.");
    });

    test("Without a body", async () => {
      const { sessionObject } = await activatedUser();

      const response = await fetch(`${webserver.origin}/api/v1/user/password`, {
        method: "PATCH",
        headers: { Cookie: `session_id=${sessionObject.token}` },
      });

      expect(response.status).toBe(400);
    });

    test("With a new password that is too short", async () => {
      const { user, sessionObject } = await activatedUser();

      const { status, body } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: "1234567",
      });

      expect(status).toBe(400);
      expect(body.message).toBe("A senha nova não é válida.");
      expect(body.action).toBe("Escolha uma senha de 8 a 72 caracteres.");
      expect(await login(user.email, CURRENT)).toBe(201);
    });

    test("With a new password longer than bcrypt reads", async () => {
      const { sessionObject } = await activatedUser();

      // 37 letras acentuadas são 74 bytes: cabem em 72 caracteres, e não em
      // 72 bytes — que é o que o bcrypt lê.
      const { status, body } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: "ã".repeat(37),
      });

      expect(status).toBe(400);
      expect(body.message).toBe("A senha nova não é válida.");
    });

    test("With a new password that is not text", async () => {
      const { sessionObject } = await activatedUser();

      const { status } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: 12345678,
      });

      expect(status).toBe(400);
    });

    test("With the same password", async () => {
      const { sessionObject } = await activatedUser();

      const { status, body } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: CURRENT,
      });

      expect(status).toBe(400);
      expect(body.message).toBe("A senha nova é igual à atual.");
    });

    test("With the current password and a valid new one", async () => {
      const { user, sessionObject } = await activatedUser();
      const otherDevice = await orchestrator.createSession(user);

      const { status, body } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: NEW,
      });

      expect(status).toBe(200);
      expect(Object.keys(body)).toEqual(["updated_at"]);
      expect(Date.parse(body.updated_at)).not.toBeNaN();

      // Só a senha nova entra.
      expect(await login(user.email, CURRENT)).toBe(401);
      expect(await login(user.email, NEW)).toBe(201);

      // Quem trocou continua dentro; o outro aparelho, não.
      expect(await whoAmI(sessionObject)).toBe(200);
      expect(await whoAmI(otherDevice)).toBe(401);

      // A senha não é guardada como veio.
      const stored = await database.query({
        text: "SELECT password FROM users WHERE id = $1;",
        values: [user.id],
      });
      expect(stored.rows[0].password).not.toBe(NEW);
    });

    test("The sessions of other accounts stay alive", async () => {
      const { sessionObject } = await activatedUser();
      const neighbor = await activatedUser();

      const { status } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: NEW,
      });

      expect(status).toBe(200);
      expect(await whoAmI(neighbor.sessionObject)).toBe(200);
    });

    test("Leaves a record of what happened", async () => {
      const { user, sessionObject } = await activatedUser();

      await changePassword(sessionObject, {
        current_password: "nao-e-esta-senha",
        password: NEW,
      });
      await changePassword(sessionObject, {
        current_password: CURRENT,
        password: NEW,
      });

      const logs = await database.query({
        text: `
          SELECT action FROM audit_logs
          WHERE actor_user_id = $1 AND action LIKE 'user.password%'
          ORDER BY created_at, action
        ;`,
        values: [user.id],
      });
      expect(logs.rows.map((row) => row.action).sort()).toEqual([
        "user.password_change_failed",
        "user.password_changed",
      ]);
    });
  });

  describe("User without the feature", () => {
    test("An account that was never activated", async () => {
      const created = await orchestrator.createUser({ password: CURRENT });
      const sessionObject = await orchestrator.createSession(created);

      const { status } = await changePassword(sessionObject, {
        current_password: CURRENT,
        password: NEW,
      });

      expect(status).toBe(403);
    });
  });
});
