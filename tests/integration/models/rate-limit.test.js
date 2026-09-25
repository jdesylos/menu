import orchestrator from "tests/orchestrator.js";
import rateLimit from "models/rateLimit.js";
import { RateLimitError } from "infra/errors.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

const WINDOW = 15 * 60 * 1000;

function attempt(identifier) {
  return rateLimit.check({ identifier, limit: 5, windowMs: WINDOW });
}

// A rota de login deixa localhost passar fora de produção — ver
// `controller.rateLimit` —, então o limite é exercitado aqui, no modelo.
describe("models/rateLimit.js", () => {
  test("Up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(attempt("login:10.0.0.1")).resolves.toBeUndefined();
    }
  });

  test("Past the limit", async () => {
    const error = await attempt("login:10.0.0.1").catch((e) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.statusCode).toBe(429);
    expect(error.retryAfter).toBeGreaterThan(0);
    expect(error.retryAfter).toBeLessThanOrEqual(WINDOW / 1000);
  });

  // Cada IP tem a sua janela: o limite de um não prende o outro.
  test("With another identifier", async () => {
    await expect(attempt("login:10.0.0.2")).resolves.toBeUndefined();
  });
});
