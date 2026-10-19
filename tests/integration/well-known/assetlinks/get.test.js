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

    test("Declares the Play signing key, which signs the app from the store", async () => {
      const response = await fetch(
        `${webserver.origin}/.well-known/assetlinks.json`,
      );
      const [declaration] = await response.json();

      expect(declaration.target.sha256_cert_fingerprints).toContain(
        "37:D6:7F:0A:98:F4:25:07:84:23:2B:EE:DF:11:D9:3E:3B:2E:02:19:BB:A1:95:FA:0C:63:C6:8B:E5:50:7D:88",
      );
    });
  });
});
