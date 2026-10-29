import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /.well-known/apple-app-site-association", () => {
  describe("Anonymous user", () => {
    test("Declares the iOS app for the account links, as JSON", async () => {
      const response = await fetch(
        `${webserver.origin}/.well-known/apple-app-site-association`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        applinks: {
          details: [
            {
              appIDs: ["UFT3B28989.com.menuspoiler.app"],
              components: [
                { "/": "/cadastro/ativar/*" },
                { "/": "/senha/recuperar/*" },
              ],
            },
          ],
        },
      });
    });
  });
});
