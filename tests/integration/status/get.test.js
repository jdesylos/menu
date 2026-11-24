import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

describe("GET /status", () => {
  test("Returns the JSON shortcut pointing to /api/v1/status", async () => {
    const response = await fetch(`${webserver.origin}/status`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("s-maxage");
    expect(await response.json()).toEqual({ status: "/api/v1/status" });
  });

  test("Rejects unsupported HTTP methods", async () => {
    const response = await fetch(`${webserver.origin}/status`, {
      method: "POST",
    });

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.name).toBe("MethodNotAllowedError");
  });
});
