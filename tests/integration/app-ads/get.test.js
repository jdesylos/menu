import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /app-ads.txt", () => {
  describe("Anonymous user", () => {
    test("Declares the AdMob account that sells the app's ads", async () => {
      const response = await fetch(`${webserver.origin}/app-ads.txt`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");

      const responseBody = await response.text();

      expect(responseBody.trim()).toBe(
        "google.com, pub-7176959202366838, DIRECT, f08c47fec0942fa0",
      );
    });
  });
});
