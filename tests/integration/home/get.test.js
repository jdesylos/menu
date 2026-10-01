import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /", () => {
  describe("Anonymous user", () => {
    test("Presents the app instead of the API", async () => {
      const response = await fetch(`${webserver.origin}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const responseBody = await response.text();

      expect(responseBody).toContain("O cardápio antes de você chegar.");
      expect(responseBody).toContain("Em breve para Android e iOS.");
    });
  });
});
