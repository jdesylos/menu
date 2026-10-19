import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /privacidade", () => {
  describe("Anonymous user", () => {
    test("Shows the same terms the app asks to accept", async () => {
      const response = await fetch(`${webserver.origin}/privacidade`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const responseBody = await response.text();

      expect(responseBody).toContain("Termos de uso e política de privacidade");
      expect(responseBody).toContain("<h2>O que coletamos</h2>");
      expect(responseBody).toContain("<h2>Seus direitos</h2>");
      expect(responseBody).toContain("JBS DESIGN E MARKETING LTDA");
      expect(responseBody).toContain("contato@menuspoiler.com.br");
      expect(responseBody).toContain('href="/conta/apagar"');
    });
  });
});
