import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /", () => {
  describe("Anonymous user", () => {
    test("Presents the brand, app summary and store links", async () => {
      const response = await fetch(`${webserver.origin}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const responseBody = await response.text();

      expect(responseBody).toContain('<html lang="pt-BR">');
      expect(responseBody).toContain('alt="Menu Spoiler"');
      expect(responseBody).toContain("O cardápio antes de você chegar.");
      expect(responseBody).not.toContain("Em breve para Android e iOS.");
      expect(responseBody).toContain(
        'href="https://apps.apple.com/br/app/menu-spoiler/id6825827914"',
      );
      expect(responseBody).toContain(
        'href="https://play.google.com/store/apps/details?id=com.menuspoiler.app"',
      );
      expect(responseBody).toContain(
        'href="mailto:contato@menuspoiler.com.br"',
      );
      expect(responseBody).toContain('href="/privacidade"');
      expect(responseBody).toContain('href="/conta/apagar"');
    });
  });
});
