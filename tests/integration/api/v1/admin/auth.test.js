import orchestrator from "tests/orchestrator.js";
import database from "infra/database.js";
import webserver from "infra/webserver.js";
import authorization from "models/authorization.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createAdminUser(overrides = {}) {
  const created = await orchestrator.createUser(overrides);
  await orchestrator.activateUser(created);
  return await orchestrator.addFeaturesToUser(
    created,
    authorization.ADMIN_PANEL_FEATURES,
  );
}

describe("Admin authentication and password recovery", () => {
  beforeEach(async () => {
    await orchestrator.deleteAllEmails();
  });

  test("Blocks regular activated user from logging in or calling /api/v1/admin/*", async () => {
    const commonUser = await orchestrator.createUser({
      email: "comum@menuspoiler.com.br",
      password: "senhacomum123",
    });
    await orchestrator.activateUser(commonUser);

    const loginResponse = await fetch(
      `${webserver.origin}/api/v1/admin/sessions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "comum@menuspoiler.com.br",
          password: "senhacomum123",
        }),
      },
    );
    expect(loginResponse.status).toBe(403);

    const commonSession = await orchestrator.createSession(commonUser);
    const placesResponse = await fetch(
      `${webserver.origin}/api/v1/admin/places`,
      {
        headers: { Cookie: `session_id=${commonSession.token}` },
      },
    );
    expect(placesResponse.status).toBe(403);
  });

  test("Authorized admin logs in, checks /user, and logs out invalidating session", async () => {
    await createAdminUser({
      username: "adminprincipal",
      email: "admin1@menuspoiler.com.br",
      password: "AdminPassword123!",
    });

    const loginRes = await fetch(`${webserver.origin}/api/v1/admin/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin1@menuspoiler.com.br",
        password: "AdminPassword123!",
      }),
    });
    expect(loginRes.status).toBe(201);
    const cookie = loginRes.headers.get("set-cookie").split(";")[0];

    const meRes = await fetch(`${webserver.origin}/api/v1/admin/user`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(200);

    const logoutRes = await fetch(`${webserver.origin}/api/v1/admin/sessions`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(logoutRes.status).toBe(200);

    const afterLogoutRes = await fetch(
      `${webserver.origin}/api/v1/admin/user`,
      {
        headers: { Cookie: cookie },
      },
    );
    expect(afterLogoutRes.status).toBe(401);
  });

  test("Admin web password recovery emails only admin accounts and resets password", async () => {
    const admin = await createAdminUser({
      email: "recadmin@menuspoiler.com.br",
      password: "SenhaAntiga123!",
    });

    const commonUser = await orchestrator.createUser({
      email: "naoadmin@menuspoiler.com.br",
      password: "SenhaComum123!",
    });
    await orchestrator.activateUser(commonUser);

    const nonAdminRec = await fetch(
      `${webserver.origin}/api/v1/admin/recoveries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "naoadmin@menuspoiler.com.br" }),
      },
    );
    expect(nonAdminRec.status).toBe(202);
    expect(await orchestrator.getLastEmail()).toBeNull();

    const adminRec = await fetch(
      `${webserver.origin}/api/v1/admin/recoveries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recadmin@menuspoiler.com.br" }),
      },
    );
    expect(adminRec.status).toBe(202);

    const emailMsg = await orchestrator.getLastEmail();
    expect(emailMsg.text).toContain("/admin/recuperar-senha/");
    const token = orchestrator.extractUUID(emailMsg.text);

    const patchRes = await fetch(
      `${webserver.origin}/api/v1/admin/recoveries/${token}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "NovaSenhaForte123!" }),
      },
    );
    expect(patchRes.status).toBe(200);

    const auditRow = await database.query({
      text: "SELECT action FROM audit_logs WHERE actor_user_id = $1 AND action = 'admin.recovery.completed';",
      values: [admin.id],
    });
    expect(auditRow.rowCount).toBe(1);
  });
});
