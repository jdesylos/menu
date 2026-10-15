import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

// Só os caminhos que NÃO chegam ao provedor: a chamada de verdade é paga, e o
// que ela faz com cada resposta está nos testes de unidade (rota, leitura e
// `infra/gemini`).
async function read(body, sessionToken) {
  const headers = { "Content-Type": "image/jpeg" };
  if (sessionToken) headers.Cookie = `session_id=${sessionToken}`;
  const response = await fetch(`${webserver.origin}/api/v1/vision/read`, {
    method: "POST",
    headers,
    body,
  });
  return { status: response.status, body: await response.json() };
}

async function sessionForActivatedUser() {
  const created = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(created);
  return await orchestrator.createSession(activated);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("POST /api/v1/vision/read", () => {
  describe("Anonymous user", () => {
    test("Without a session", async () => {
      const { status, body } = await read(JPEG);

      expect(status).toBe(403);
      expect(body.action).toBe(
        'Verifique se o seu usuário possui a feature "create:menu"',
      );
    });

    // Para o aplicativo, 401 é a sessão morta — e ele a esquece.
    test("With a nonexistent session", async () => {
      const { status, body } = await read(
        JPEG,
        "f0b62a5ff97ae607701ceeee2e3c4987c4b9debb534410e2444f9eb2288b6e3b90158a71d086e31eabef9b36cbb549e1",
      );

      expect(status).toBe(401);
      expect(body.name).toBe("UnauthorizedError");
    });
  });

  describe("Default user", () => {
    test("Without a photo", async () => {
      const sessionObject = await sessionForActivatedUser();

      const { status, body } = await read(Buffer.alloc(0), sessionObject.token);

      expect(status).toBe(400);
      expect(body.message).toBe("A foto não veio.");
    });

    test("With something that is not a JPEG", async () => {
      const sessionObject = await sessionForActivatedUser();

      const { status, body } = await read(
        Buffer.from("isto não é uma foto"),
        sessionObject.token,
      );

      expect(status).toBe(400);
      expect(body.message).toBe("A foto não é um JPEG.");
    });

    test("With a photo over 3 MB", async () => {
      const sessionObject = await sessionForActivatedUser();

      const { status, body } = await read(
        Buffer.alloc(3 * 1024 * 1024 + 1, 0xff),
        sessionObject.token,
      );

      expect(status).toBe(400);
      expect(body.message).toBe("A foto passa de 3 MB.");
    });
  });
});
