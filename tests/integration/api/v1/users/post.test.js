import orchestrator from "tests/orchestrator.js";
import user from "models/user.js";
import password from "models/password.js";
import database from "infra/database.js";
import webserver from "infra/webserver.js";
import { NotFoundError } from "infra/errors.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
  await orchestrator.deleteAllEmails();
});

// A mesma para o email novo e para o que já tem conta — ver a rota.
const GENERIC_SIGNUP_RESPONSE = {
  message:
    "Se este email ainda não estava cadastrado, enviamos um link de ativação. Verifique sua caixa de entrada.",
};

async function auditActions(userId) {
  const result = await database.query({
    text: `
      SELECT action FROM audit_logs
      WHERE actor_user_id = $1 OR target_user_id = $1
      ORDER BY created_at
    ;`,
    values: [userId],
  });
  return result.rows.map((row) => row.action);
}

describe("POST /api/v1/users", () => {
  describe("Anonymous user", () => {
    test("With unique and valid data", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "menuspoiler",
          email: "contato@menuspoiler.com.br",
          password: "senha123",
        }),
      });

      expect(response.status).toBe(201);
      // A resposta não traz a conta: ela seria diferente da do email
      // repetido, e a diferença diria quem tem conta aqui.
      expect(await response.json()).toEqual(GENERIC_SIGNUP_RESPONSE);

      const userInDatabase = await user.findOneByUsername("menuspoiler");
      expect(await auditActions(userInDatabase.id)).toEqual(["user.created"]);

      // O email não leva o nome de usuário, que é quem cadastra que escolhe.
      const lastEmail = await orchestrator.getLastEmail();
      expect(lastEmail.subject).toBe("Ative seu cadastro no Menu Spoiler!");
      expect(lastEmail.text).not.toContain("menuspoiler,");

      const correctPasswordMatch = await password.compare(
        "senha123",
        userInDatabase.password,
      );

      const incorrectPasswordMatch = await password.compare(
        "SenhaErrada",
        userInDatabase.password,
      );

      expect(correctPasswordMatch).toBe(true);
      expect(incorrectPasswordMatch).toBe(false);
    });

    test("With duplicated `email`", async () => {
      const response1 = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "emailduplicado1",
          email: "duplicado@menuspoiler.com.br",
          password: "senha123",
        }),
      });

      expect(response1.status).toBe(201);

      const response2 = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "emailduplicado2",
          email: "Duplicado@menuspoiler.com.br",
          password: "senha123",
        }),
      });

      // Igual ao email novo: quem pergunta não fica sabendo que ele tem conta.
      expect(response2.status).toBe(201);
      expect(await response2.json()).toEqual(GENERIC_SIGNUP_RESPONSE);

      // Nenhuma conta nova...
      const notCreated = await user
        .findOneByUsername("emailduplicado2")
        .catch((error) => error);
      expect(notCreated).toBeInstanceOf(NotFoundError);

      // ...e quem fica sabendo é o dono do email.
      const owner = await user.findOneByEmail("duplicado@menuspoiler.com.br");
      const lastEmail = await orchestrator.getLastEmail();
      expect(lastEmail.recipients[0]).toBe("<duplicado@menuspoiler.com.br>");
      expect(lastEmail.subject).toBe(
        "Tentativa de cadastro com seu email no Menu Spoiler",
      );
      expect(lastEmail.text).not.toContain("emailduplicado");
      expect(await auditActions(owner.id)).toEqual([
        "user.created",
        "user.signup_duplicate_email",
      ]);
    });

    test("With duplicated `username`", async () => {
      const response1 = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "usernameduplicado",
          email: "usernameduplicado1@menuspoiler.com.br",
          password: "senha123",
        }),
      });

      expect(response1.status).toBe(201);

      const response2 = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "UsernameDuplicado",
          email: "usernameduplicado2@menuspoiler.com.br",
          password: "senha123",
        }),
      });

      expect(response2.status).toBe(400);

      const response2Body = await response2.json();

      expect(response2Body).toEqual({
        name: "ValidationError",
        message: "O username informado já está sendo utilizado.",
        action: "Utilize outro username para realizar esta operação.",
        status_code: 400,
      });
    });
  });

  describe("Default user", () => {
    test("With unique and valid data", async () => {
      const user1 = await orchestrator.createUser();
      await orchestrator.activateUser(user1);
      const user1SessionObject = await orchestrator.createSession(user1);

      const user2Response = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_id=${user1SessionObject.token}`,
        },
        body: JSON.stringify({
          username: "usuariologado",
          email: "usuariologado@menuspoiler.com.br",
          password: "senha123",
        }),
      });

      expect(user2Response.status).toBe(403);

      const user2ResponseBody = await user2Response.json();

      expect(user2ResponseBody).toEqual({
        name: "ForbiddenError",
        message: "Você não possui permissão para executar esta ação.",
        action: 'Verifique se o seu usuário possui a feature "create:user"',
        status_code: 403,
      });
    });
  });
});
