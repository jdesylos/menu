import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";
import recovery from "models/recovery.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /senha/recuperar/[token]", () => {
  test("Explains where to open the link, and never spends the token", async () => {
    const created = await orchestrator.createUser({
      password: "senha-esquecida",
    });
    const token = await recovery.create(created.id);

    const response = await fetch(
      `${webserver.origin}/senha/recuperar/${token.id}`,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Crie sua senha nova no aplicativo");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('name="referrer" content="no-referrer"');
    // A página não tem campo de senha: quem escolhe a senha é o aplicativo.
    expect(html).not.toContain("<input");

    // Abrir a página — uma pessoa, ou um pré-visualizador de links — não
    // gasta o link.
    const row = await database.query({
      text: "SELECT used_at FROM password_recovery_tokens WHERE id = $1;",
      values: [token.id],
    });
    expect(row.rows[0].used_at).toBeNull();
  });
});

describe("GET /cadastro/ativar/[token]", () => {
  test("Still explains where to open the activation link", async () => {
    const response = await fetch(
      `${webserver.origin}/cadastro/ativar/256bc49a-132a-42e4-8334-998fd17ee71e`,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Ative sua conta no aplicativo");
    expect(html).toContain("Ativar conta — Menu Spoiler</title>");
  });
});
