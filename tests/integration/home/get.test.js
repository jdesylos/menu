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
      expect(responseBody).toContain('href="/favicon.ico"');
      expect(responseBody).toContain('href="/favicon-32x32.png"');
      expect(responseBody).toContain('href="/icon-192.png"');
      expect(responseBody).toContain('href="/apple-touch-icon.png"');
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

    test("Serves favicon and touch icon files", async () => {
      const files = [
        "/favicon.ico",
        "/favicon-32x32.png",
        "/icon-192.png",
        "/apple-touch-icon.png",
      ];

      for (const file of files) {
        const res = await fetch(`${webserver.origin}${file}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^image\//i);
        expect(res.headers.get("cache-control")).toContain("max-age=86400");
        const buf = await res.arrayBuffer();
        expect(buf.byteLength).toBeGreaterThan(100);
      }
    });
  });
});
