import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createPlace(name) {
  const result = await database.query({
    text: `
      INSERT INTO places (source, source_id, name, latitude, longitude)
      VALUES ('overture', $1, $1, -23.5505, -46.6333)
      RETURNING id
    ;`,
    values: [name],
  });
  return result.rows[0].id;
}

async function activatedUser(userObject) {
  const created = await orchestrator.createUser(userObject);
  const activated = await orchestrator.activateUser(created);
  const sessionObject = await orchestrator.createSession(activated);
  return { user: activated, sessionObject };
}

async function sendMenu(placeId, sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/menus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${sessionObject.token}`,
    },
    body: JSON.stringify({
      place_id: placeId,
      currency: "BRL",
      sections: [
        { title: "Pratos", items: [{ name: "Feijoada", price_cents: 5800 }] },
      ],
    }),
  });
  expect(response.status).toBe(201);
  return await response.json();
}

async function erase(sessionObject) {
  const headers = sessionObject
    ? { Cookie: `session_id=${sessionObject.token}` }
    : {};
  const response = await fetch(`${webserver.origin}/api/v1/user`, {
    method: "DELETE",
    headers,
  });
  return {
    status: response.status,
    setCookie: response.headers.get("set-cookie"),
    body: await response.json(),
  };
}

describe("DELETE /api/v1/user", () => {
  describe("Anonymous user", () => {
    test("Without a session", async () => {
      const { status, body } = await erase();

      expect(status).toBe(403);
      expect(body.action).toBe(
        'Verifique se o seu usuário possui a feature "read:session"',
      );
    });
  });

  describe("Default user", () => {
    test("Erasing the own account", async () => {
      const { user, sessionObject } = await activatedUser({
        username: "ContaQueSai",
        email: "conta.que.sai@menuspoiler.com.br",
        password: "senha-que-some",
      });

      const { status, body, setCookie } = await erase(sessionObject);

      expect(status).toBe(200);
      expect(body).toEqual({ deleted_at: expect.any(String) });
      expect(Date.parse(body.deleted_at)).not.toBeNaN();
      // O cookie do navegador sai junto.
      expect(setCookie).toContain("session_id=invalid");

      // A linha fica, vazia: nada nela diz de quem era.
      const stored = await database.query({
        text: "SELECT * FROM users WHERE id = $1;",
        values: [user.id],
      });
      expect(stored.rows[0]).toEqual({
        id: user.id,
        username: null,
        email: null,
        password: null,
        features: [],
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
        deleted_at: expect.any(Date),
      });
    });

    test("The session dies with the account", async () => {
      const { sessionObject } = await activatedUser();
      await erase(sessionObject);

      const response = await fetch(`${webserver.origin}/api/v1/user`, {
        headers: { Cookie: `session_id=${sessionObject.token}` },
      });

      expect(response.status).toBe(401);

      const stored = await database.query({
        text: "SELECT count(*)::int AS total FROM sessions WHERE token = $1;",
        values: [sessionObject.token],
      });
      expect(stored.rows[0].total).toBe(0);
    });

    test("Logging in again is not possible", async () => {
      const { sessionObject } = await activatedUser({
        email: "nao.entra.mais@menuspoiler.com.br",
        password: "senha-antiga",
      });
      await erase(sessionObject);

      const response = await fetch(`${webserver.origin}/api/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "nao.entra.mais@menuspoiler.com.br",
          password: "senha-antiga",
        }),
      });

      expect(response.status).toBe(401);
    });

    // O cardápio é do lugar, e não de quem o fotografou: apagar a conta não
    // tira nada do mapa.
    test("The menus it sent stay", async () => {
      const placeId = await createPlace("Bar de Quem Saiu");
      const { user, sessionObject } = await activatedUser();
      const sent = await sendMenu(placeId, sessionObject);

      await erase(sessionObject);

      const response = await fetch(
        `${webserver.origin}/api/v1/menus?place_id=${placeId}`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(sent.id);
      expect(body.sections[0].items[0].name).toBe("Feijoada");

      const listed = await fetch(`${webserver.origin}/api/v1/menus/places`);
      const places = (await listed.json()).places;
      expect(places.map((place) => place.id)).toContain(placeId);

      // Ainda aponta para a conta, que agora não identifica ninguém.
      const stored = await database.query({
        text: "SELECT created_by FROM menus WHERE id = $1;",
        values: [sent.id],
      });
      expect(stored.rows[0].created_by).toBe(user.id);
    });

    // Nulo não ocupa o índice único: o nome e o email voltam a estar livres.
    test("The username and the email are free again", async () => {
      const { sessionObject } = await activatedUser({
        username: "NomeQueVolta",
        email: "email.que.volta@menuspoiler.com.br",
      });
      await erase(sessionObject);

      const response = await fetch(`${webserver.origin}/api/v1/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "NomeQueVolta",
          email: "email.que.volta@menuspoiler.com.br",
          password: "outra-senha-qualquer",
          privacy_accepted: true,
        }),
      });

      expect(response.status).toBe(201);
    });

    test("The activation links and the audit IPs go with it", async () => {
      const created = await orchestrator.createUser();
      const activated = await orchestrator.activateUser(created);
      // O login pela rota é o que grava o registro de auditoria, com o IP.
      const login = await fetch(`${webserver.origin}/api/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activated.email,
          password: "validpassword",
        }),
      });
      expect(login.status).toBe(201);
      const sessionObject = await login.json();

      await erase(sessionObject);

      const tokens = await database.query({
        text: `
          SELECT count(*)::int AS total
          FROM user_activation_tokens
          WHERE user_id = $1
        ;`,
        values: [activated.id],
      });
      expect(tokens.rows[0].total).toBe(0);

      const logs = await database.query({
        text: `
          SELECT count(*)::int AS total, count(ip)::int AS with_ip
          FROM audit_logs
          WHERE actor_user_id = $1 OR target_user_id = $1
        ;`,
        values: [activated.id],
      });
      // O registro do que aconteceu fica; o endereço de onde veio, não.
      expect(logs.rows[0].total).toBeGreaterThan(0);
      expect(logs.rows[0].with_ip).toBe(0);
    });
  });
});
