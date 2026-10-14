import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";
import user from "models/user.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function activatedUser(userObject) {
  const created = await orchestrator.createUser(userObject);
  const activated = await orchestrator.activateUser(created);
  const sessionObject = await orchestrator.createSession(activated);
  return { user: activated, sessionObject };
}

async function changeUsername(sessionObject, body) {
  const headers = { "Content-Type": "application/json" };
  if (sessionObject) {
    headers.Cookie = `session_id=${sessionObject.token}`;
  }
  const response = await fetch(`${webserver.origin}/api/v1/user/username`, {
    method: "PATCH",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function whoAmI(sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/user`, {
    headers: { Cookie: `session_id=${sessionObject.token}` },
  });
  return { status: response.status, body: await response.json() };
}

const NOT_INFORMED = {
  name: "ValidationError",
  message: "O nome de usuário não foi informado.",
  action: "Escolha um nome de usuário e tente de novo.",
  status_code: 400,
};

describe("PATCH /api/v1/user/username", () => {
  describe("Anonymous user", () => {
    test("Without a session", async () => {
      const { status, body } = await changeUsername(null, {
        username: "semSessao",
      });

      expect(status).toBe(403);
      expect(body.name).toBe("ForbiddenError");
    });
  });

  describe("Default user", () => {
    test("With a new and free username", async () => {
      const { user: activated, sessionObject } = await activatedUser();

      const { status, body } = await changeUsername(sessionObject, {
        username: "nomeNovo",
      });

      expect(status).toBe(200);
      expect(body).toEqual({
        id: activated.id,
        username: "nomeNovo",
        email: activated.email,
        features: activated.features,
        created_at: body.created_at,
        updated_at: body.updated_at,
      });
      expect(body.updated_at > body.created_at).toBe(true);

      // A sessão continua a mesma, e já responde com o nome novo.
      const me = await whoAmI(sessionObject);
      expect(me.status).toBe(200);
      expect(me.body.username).toBe("nomeNovo");
    });

    test("The spaces around the username are dropped", async () => {
      const { sessionObject } = await activatedUser();

      const { status, body } = await changeUsername(sessionObject, {
        username: "  comEspacos  ",
      });

      expect(status).toBe(200);
      expect(body.username).toBe("comEspacos");
    });

    test("With a username taken by another account, in any case", async () => {
      await orchestrator.createUser({ username: "jaExiste" });
      const { user: activated, sessionObject } = await activatedUser();

      const { status, body } = await changeUsername(sessionObject, {
        username: "JAEXISTE",
      });

      expect(status).toBe(400);
      expect(body).toEqual({
        name: "ValidationError",
        message: "O username informado já está sendo utilizado.",
        action: "Utilize outro username para realizar esta operação.",
        status_code: 400,
      });
      const userInDatabase = await user.findOneById(activated.id);
      expect(userInDatabase.username).toBe(activated.username);
    });

    test("Changing only the case of its own username", async () => {
      const { sessionObject } = await activatedUser({ username: "maiusculas" });

      const { status, body } = await changeUsername(sessionObject, {
        username: "Maiusculas",
      });

      expect(status).toBe(200);
      expect(body.username).toBe("Maiusculas");
    });

    test("With the same username", async () => {
      const { sessionObject } = await activatedUser({ username: "oMesmo" });

      const { status, body } = await changeUsername(sessionObject, {
        username: " oMesmo ",
      });

      expect(status).toBe(400);
      expect(body).toEqual({
        name: "ValidationError",
        message: "O nome de usuário novo é igual ao atual.",
        action: "Escolha um nome diferente do atual.",
        status_code: 400,
      });
    });

    test("The old username is free for another account", async () => {
      const { sessionObject } = await activatedUser({ username: "nomeVelho" });
      await changeUsername(sessionObject, { username: "nomeQueFica" });

      const other = await activatedUser();
      const { status, body } = await changeUsername(other.sessionObject, {
        username: "nomeVelho",
      });

      expect(status).toBe(200);
      expect(body.username).toBe("nomeVelho");
    });

    test("Without a body", async () => {
      const { sessionObject } = await activatedUser();

      const { status, body } = await changeUsername(sessionObject);

      expect(status).toBe(400);
      expect(body).toEqual(NOT_INFORMED);
    });

    test("With a blank username", async () => {
      const { sessionObject } = await activatedUser();

      const { status, body } = await changeUsername(sessionObject, {
        username: "   ",
      });

      expect(status).toBe(400);
      expect(body).toEqual(NOT_INFORMED);
    });

    test("With a username that is not text", async () => {
      const { sessionObject } = await activatedUser();

      const { status, body } = await changeUsername(sessionObject, {
        username: 12345,
      });

      expect(status).toBe(400);
      expect(body).toEqual(NOT_INFORMED);
    });

    test("The limit counts characters, and not bytes", async () => {
      const { sessionObject } = await activatedUser();

      const fits = await changeUsername(sessionObject, {
        username: "ç".repeat(30),
      });
      expect(fits.status).toBe(200);

      const tooLong = await changeUsername(sessionObject, {
        username: "a".repeat(31),
      });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body).toEqual({
        name: "ValidationError",
        message: "O nome de usuário passa de 30 caracteres.",
        action: "Escolha um nome com até 30 caracteres.",
        status_code: 400,
      });
    });

    test("Only the username changes", async () => {
      const { user: activated, sessionObject } = await activatedUser();

      await changeUsername(sessionObject, {
        username: "soONome",
        email: "outro@menuspoiler.com.br",
        password: "outra-senha-qualquer",
      });

      const userInDatabase = await user.findOneById(activated.id);
      expect(userInDatabase.username).toBe("soONome");
      expect(userInDatabase.email).toBe(activated.email);
      expect(userInDatabase.password).toBe(activated.password);
    });

    test("Leaves a record of what happened", async () => {
      const { user: activated, sessionObject } = await activatedUser();

      await changeUsername(sessionObject, { username: "comRegistro" });

      const logs = await database.query({
        text: `
          SELECT action FROM audit_logs
          WHERE actor_user_id = $1 AND action LIKE 'user.username%'
        ;`,
        values: [activated.id],
      });
      expect(logs.rows.map((row) => row.action)).toEqual([
        "user.username_changed",
      ]);
    });
  });

  describe("User without the feature", () => {
    test("An account that was never activated", async () => {
      const created = await orchestrator.createUser();
      const sessionObject = await orchestrator.createSession(created);

      const { status } = await changeUsername(sessionObject, {
        username: "naoAtivada",
      });

      expect(status).toBe(403);
    });
  });
});
