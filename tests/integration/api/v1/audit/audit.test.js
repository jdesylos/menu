import orchestrator from "tests/orchestrator.js";
import database from "infra/database.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function findAuditLogs(action) {
  const result = await database.query({
    text: `SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at DESC`,
    values: [action],
  });
  return result.rows;
}

// O login deixa rastro: quem entrou, quem tentou e não conseguiu, quem saiu.
// Veio do repositório judhagsan, junto com o limite de tentativas.
describe("Audit log", () => {
  test("Successful login records session.created", async () => {
    const targetUser = await orchestrator.createUser({
      email: "auditlogin@menuspoiler.com.br",
      password: "senha12345",
    });
    await orchestrator.activateUser(targetUser);

    const response = await fetch(`${webserver.origin}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "auditlogin@menuspoiler.com.br",
        password: "senha12345",
      }),
    });
    expect(response.status).toBe(201);

    const logs = await findAuditLogs("session.created");
    const matching = logs.find((l) => l.actor_user_id === targetUser.id);
    expect(matching).toBeDefined();
    expect(matching.ip).toBeTruthy();
  });

  // Sem ator: quem errou a senha não está autenticado, e gravar o id da conta
  // tentada diria a quem lê o log se o email existe.
  test("Failed login records session.failed without revealing user", async () => {
    const response = await fetch(`${webserver.origin}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "naoexiste@menuspoiler.com.br",
        password: "errado",
      }),
    });
    expect(response.status).toBe(401);

    const logs = await findAuditLogs("session.failed");
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].actor_user_id).toBeNull();
  });

  test("Logout records session.deleted", async () => {
    const targetUser = await orchestrator.createUser();
    await orchestrator.activateUser(targetUser);
    const sessionObject = await orchestrator.createSession(targetUser);

    const response = await fetch(`${webserver.origin}/api/v1/sessions`, {
      method: "DELETE",
      headers: { Cookie: `session_id=${sessionObject.token}` },
    });
    expect(response.status).toBe(200);

    const logs = await findAuditLogs("session.deleted");
    const matching = logs.find((l) => l.actor_user_id === targetUser.id);
    expect(matching).toBeDefined();
  });
});
