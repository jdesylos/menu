import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /conta/apagar", () => {
  describe("Anonymous user", () => {
    test("Explains how to delete the account, and what stays", async () => {
      const response = await fetch(`${webserver.origin}/conta/apagar`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const responseBody = await response.text();

      expect(responseBody).toContain("Como apagar sua conta");
      expect(responseBody).toContain("<h2>Pelo aplicativo</h2>");
      expect(responseBody).toContain("<h2>Sem o aplicativo</h2>");
      expect(responseBody).toContain(
        'href="mailto:contato@menuspoiler.com.br"',
      );
      expect(responseBody).toContain("<h2>O que é apagado</h2>");
      expect(responseBody).toContain("<h2>O que continua</h2>");
      expect(responseBody).toContain('href="/privacidade"');
    });
  });
});
