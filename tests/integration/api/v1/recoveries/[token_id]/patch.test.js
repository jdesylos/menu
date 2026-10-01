import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";
import recovery from "models/recovery.js";
import user from "models/user.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

const FORGOTTEN = "senha-esquecida";
const NEW = "senha-de-agora";

const NOT_FOUND = {
  name: "NotFoundError",
  message:
    "O link de recuperação de senha não foi encontrado, já foi usado ou expirou.",
  action: 'Peça um link novo em "Esqueci a senha".',
  status_code: 404,
};

async function activatedUser() {
  const created = await orchestrator.createUser({ password: FORGOTTEN });
  return await orchestrator.activateUser(created);
}

async function resetPassword(tokenId, body) {
  const response = await fetch(
    `${webserver.origin}/api/v1/recoveries/${tokenId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
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

async function tokenRow(tokenId) {
  const results = await database.query({
    text: "SELECT * FROM password_recovery_tokens WHERE id = $1;",
    values: [tokenId],
  });
  return results.rows[0];
}

describe("PATCH /api/v1/recoveries/[token_id]", () => {
  describe("Anonymous user", () => {
    test("With a valid token and a valid password", async () => {
      const account = await activatedUser();
      const phone = await orchestrator.createSession(account);
      const tablet = await orchestrator.createSession(account);
      const token = await recovery.create(account.id);

      const { status, body } = await resetPassword(token.id, {
        password: NEW,
      });

      expect(status).toBe(200);
      expect(Object.keys(body)).toEqual(["used_at"]);
      expect(Date.parse(body.used_at)).not.toBeNaN();

      // Só a senha nova entra.
      expect(await login(account.email, FORGOTTEN)).toBe(401);
      expect(await login(account.email, NEW)).toBe(201);

      // Todas as sessões de antes caem: quem esqueceu a senha não está
      // dentro, e quem perdeu a conta quer o outro fora.
      expect(await whoAmI(phone)).toBe(401);
      expect(await whoAmI(tablet)).toBe(401);

      // A senha não é guardada como veio.
      const stored = await user.findOneById(account.id);
      expect(stored.password).not.toBe(NEW);
    });

    test("With a token that was already used", async () => {
      const account = await activatedUser();
      const token = await recovery.create(account.id);
      await resetPassword(token.id, { password: NEW });

      const { status, body } = await resetPassword(token.id, {
        password: "outra-senha-qualquer",
      });

      expect(status).toBe(404);
      expect(body).toEqual(NOT_FOUND);
      expect(await login(account.email, NEW)).toBe(201);
    });

    test("With an expired token", async () => {
      const account = await activatedUser();

      jest.useFakeTimers({
        now: new Date(Date.now() - recovery.EXPIRATION_IN_MILLISECONDS),
      });
      const expiredToken = await recovery.create(account.id);
      jest.useRealTimers();

      const { status, body } = await resetPassword(expiredToken.id, {
        password: NEW,
      });

      expect(status).toBe(404);
      expect(body).toEqual(NOT_FOUND);
      expect(await login(account.email, FORGOTTEN)).toBe(201);
    });

    test("With a nonexistent token", async () => {
      const { status, body } = await resetPassword(
        "256bc49a-132a-42e4-8334-998fd17ee71e",
        { password: NEW },
      );

      expect(status).toBe(404);
      expect(body).toEqual(NOT_FOUND);
    });

    test("With something that is not a token", async () => {
      // O id vai para uma coluna `uuid`: o que não tem a forma de um é
      // recusado antes do banco, e não vira erro 500.
      for (const tokenId of ["nao-e-um-token", "256bc49a", "1%27%20OR%201=1"]) {
        const { status, body } = await resetPassword(tokenId, {
          password: NEW,
        });

        expect(status).toBe(404);
        expect(body).toEqual(NOT_FOUND);
      }
    });

    test("With an activation token in its place", async () => {
      const account = await activatedUser();
      const activationToken = await database.query({
        text: `
          INSERT INTO user_activation_tokens (user_id, expires_at)
          VALUES ($1, NOW() + interval '15 minutes')
          RETURNING id
        ;`,
        values: [account.id],
      });

      // Um link de ativação não troca senha.
      const { status } = await resetPassword(activationToken.rows[0].id, {
        password: NEW,
      });

      expect(status).toBe(404);
      expect(await login(account.email, FORGOTTEN)).toBe(201);
    });

    test("With a password that is not valid", async () => {
      const account = await activatedUser();
      const token = await recovery.create(account.id);

      for (const password of ["1234567", "ã".repeat(37), 12345678, undefined]) {
        const { status, body } = await resetPassword(token.id, { password });

        expect(status).toBe(400);
        expect(body).toEqual({
          name: "ValidationError",
          message: "A senha nova não é válida.",
          action: "Escolha uma senha de 8 a 72 caracteres.",
          status_code: 400,
        });
      }

      // A senha de antes continua, e o link também: dá para corrigir e
      // mandar de novo.
      expect(await login(account.email, FORGOTTEN)).toBe(201);
      expect((await tokenRow(token.id)).used_at).toBeNull();
      expect((await resetPassword(token.id, { password: NEW })).status).toBe(
        200,
      );
    });

    test("Without a body", async () => {
      const account = await activatedUser();
      const token = await recovery.create(account.id);

      const { status } = await resetPassword(token.id, undefined);

      expect(status).toBe(400);
      expect((await tokenRow(token.id)).used_at).toBeNull();
    });

    test("The other pending tokens of the account stop working", async () => {
      const account = await activatedUser();
      const first = await recovery.create(account.id);
      const second = await recovery.create(account.id);

      expect((await resetPassword(second.id, { password: NEW })).status).toBe(
        200,
      );

      const { status } = await resetPassword(first.id, {
        password: "senha-de-quem-achou-o-email",
      });
      expect(status).toBe(404);
      expect(await login(account.email, NEW)).toBe(201);
    });

    test("The tokens and sessions of other accounts are left alone", async () => {
      const account = await activatedUser();
      const neighbor = await activatedUser();
      const neighborSession = await orchestrator.createSession(neighbor);
      const neighborToken = await recovery.create(neighbor.id);
      const token = await recovery.create(account.id);

      await resetPassword(token.id, { password: NEW });

      expect(await whoAmI(neighborSession)).toBe(200);
      expect((await tokenRow(neighborToken.id)).used_at).toBeNull();
      expect(await login(neighbor.email, FORGOTTEN)).toBe(201);
    });

    test("An account that was never activated still cannot log in", async () => {
      const created = await orchestrator.createUser({ password: FORGOTTEN });
      const token = await recovery.create(created.id);

      const { status } = await resetPassword(token.id, { password: NEW });

      // A senha troca, mas recuperar não ativa: entrar continua pedindo o
      // link de ativação.
      expect(status).toBe(200);
      expect(await login(created.email, NEW)).toBe(403);
    });

    test("Leaves a record of the use", async () => {
      const account = await activatedUser();
      const token = await recovery.create(account.id);

      await resetPassword(token.id, { password: NEW });

      const logs = await database.query({
        text: `
          SELECT action FROM audit_logs
          WHERE target_user_id = $1 AND action = 'recovery.used'
        ;`,
        values: [account.id],
      });
      expect(logs.rowCount).toBe(1);
    });
  });

  describe("What else spends a token", () => {
    test("Changing the password with the current one", async () => {
      const account = await activatedUser();
      const sessionObject = await orchestrator.createSession(account);
      const token = await recovery.create(account.id);

      const changed = await fetch(`${webserver.origin}/api/v1/user/password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_id=${sessionObject.token}`,
        },
        body: JSON.stringify({ current_password: FORGOTTEN, password: NEW }),
      });
      expect(changed.status).toBe(200);

      // Quem acabou de escolher a senha não esqueceu: o link pendente não
      // troca de novo.
      const { status } = await resetPassword(token.id, {
        password: "senha-de-quem-achou-o-email",
      });
      expect(status).toBe(404);
      expect(await login(account.email, NEW)).toBe(201);
    });

    test("Erasing the account", async () => {
      const account = await activatedUser();
      const token = await recovery.create(account.id);

      await user.erase(account.id);

      expect(await tokenRow(token.id)).toBeUndefined();
      expect((await resetPassword(token.id, { password: NEW })).status).toBe(
        404,
      );
    });
  });
});
