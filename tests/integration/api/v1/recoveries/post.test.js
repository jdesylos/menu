import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";
import user from "models/user.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

beforeEach(async () => {
  await orchestrator.deleteAllEmails();
});

const SENT = {
  message:
    "Se houver uma conta com este email, enviamos um link para criar uma senha nova.",
};

async function requestRecovery(body) {
  const response = await fetch(`${webserver.origin}/api/v1/recoveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function tokensOf(userId) {
  const results = await database.query({
    text: "SELECT * FROM password_recovery_tokens WHERE user_id = $1;",
    values: [userId],
  });
  return results.rows;
}

describe("POST /api/v1/recoveries", () => {
  describe("Anonymous user", () => {
    test("With the email of an account", async () => {
      const createdUser = await orchestrator.createUser({
        username: "QuemEsqueceu",
        email: "quem.esqueceu@menuspoiler.com.br",
      });

      const { status, body } = await requestRecovery({
        email: "quem.esqueceu@menuspoiler.com.br",
      });

      expect(status).toBe(201);
      expect(body).toEqual(SENT);

      const tokens = await tokensOf(createdUser.id);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].used_at).toBeNull();

      // Quinze minutos, com a folga de quanto o teste demorou.
      const lifetime = tokens[0].expires_at - tokens[0].created_at;
      expect(Math.abs(lifetime - 15 * 60 * 1000)).toBeLessThan(5000);

      const email = await orchestrator.getLastEmail();
      expect(email.sender).toBe("<contato@menuspoiler.com.br>");
      expect(email.recipients[0]).toBe("<quem.esqueceu@menuspoiler.com.br>");
      expect(email.subject).toBe("Crie uma senha nova no Menu Spoiler");
      expect(email.text).toContain("QuemEsqueceu");
      // O link é o caminho que o aplicativo aceita, com o token da linha.
      expect(email.text).toContain(
        `${webserver.origin}/senha/recuperar/${tokens[0].id}`,
      );
    });

    test("With the email in another case, and spaces around it", async () => {
      const createdUser = await orchestrator.createUser({
        email: "caixa.alta@menuspoiler.com.br",
      });

      const { status, body } = await requestRecovery({
        email: "  Caixa.Alta@MenuSpoiler.com.br ",
      });

      expect(status).toBe(201);
      expect(body).toEqual(SENT);
      expect(await tokensOf(createdUser.id)).toHaveLength(1);
    });

    test("With an email that has no account", async () => {
      const { status, body } = await requestRecovery({
        email: "ninguem@menuspoiler.com.br",
      });

      // A MESMA resposta de quem tem conta, e nenhum email sai.
      expect(status).toBe(201);
      expect(body).toEqual(SENT);
      expect(await orchestrator.getLastEmail()).toBeNull();
    });

    test("With the email of an account that was erased", async () => {
      const createdUser = await orchestrator.createUser({
        email: "ja.foi.embora@menuspoiler.com.br",
      });
      await user.erase(createdUser.id);

      const { status, body } = await requestRecovery({
        email: "ja.foi.embora@menuspoiler.com.br",
      });

      expect(status).toBe(201);
      expect(body).toEqual(SENT);
      expect(await orchestrator.getLastEmail()).toBeNull();
      expect(await tokensOf(createdUser.id)).toHaveLength(0);
    });

    test("Without an email", async () => {
      for (const body of [{}, { email: "" }, { email: "   " }, { email: 42 }]) {
        const response = await requestRecovery(body);

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          name: "ValidationError",
          message: "O email não foi informado.",
          action: "Informe o email da sua conta e tente de novo.",
          status_code: 400,
        });
      }
      expect(await orchestrator.getLastEmail()).toBeNull();
    });

    test("Without a body", async () => {
      const { status } = await requestRecovery(undefined);

      expect(status).toBe(400);
    });

    test("Twice in a row", async () => {
      const createdUser = await orchestrator.createUser({
        email: "duas.vezes@menuspoiler.com.br",
      });

      await requestRecovery({ email: "duas.vezes@menuspoiler.com.br" });
      await requestRecovery({ email: "duas.vezes@menuspoiler.com.br" });

      // Dois links, e os dois valem até um deles ser usado.
      const tokens = await tokensOf(createdUser.id);
      expect(tokens).toHaveLength(2);
      expect(tokens[0].id).not.toBe(tokens[1].id);
    });

    test("Leaves a record of the request", async () => {
      const createdUser = await orchestrator.createUser({
        email: "auditada@menuspoiler.com.br",
      });

      await requestRecovery({ email: "auditada@menuspoiler.com.br" });

      const logs = await database.query({
        text: `
          SELECT action FROM audit_logs
          WHERE target_user_id = $1 AND action = 'recovery.requested'
        ;`,
        values: [createdUser.id],
      });
      expect(logs.rowCount).toBe(1);
    });
  });
});
