import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /.well-known/assetlinks.json", () => {
  describe("Anonymous user", () => {
    test("Declares the Android app for the activation link", async () => {
      const response = await fetch(
        `${webserver.origin}/.well-known/assetlinks.json`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const responseBody = await response.json();

      expect(responseBody).toEqual([
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "com.menuspoiler.app",
            sha256_cert_fingerprints: expect.arrayContaining([
              expect.stringMatching(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/),
            ]),
          },
        },
      ]);
    });
  });
});
