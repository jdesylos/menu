import orchestrator from "tests/orchestrator.js";
import database from "infra/database.js";
import webserver from "infra/webserver.js";
import authorization from "models/authorization.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createAdminCookie() {
  const u = await orchestrator.createUser();
  await orchestrator.activateUser(u);
  const admin = await orchestrator.addFeaturesToUser(
    u,
    authorization.ADMIN_PANEL_FEATURES,
  );
  const sess = await orchestrator.createSession(admin);
  return { admin, cookie: `session_id=${sess.token}` };
}

describe("Admin user management & audit logs", () => {
  beforeEach(async () => {
    await orchestrator.deleteAllEmails();
  });

  test("Lists users, changes username & email (verify + immediate), records audit, and erases target user", async () => {
    const { admin, cookie } = await createAdminCookie();
    const target = await orchestrator.createUser({
      username: "usuarioteste",
      email: "antigo@menuspoiler.com.br",
    });
    await orchestrator.activateUser(target);

    const listRes = await fetch(
      `${webserver.origin}/api/v1/admin/users?q=usuarioteste`,
      { headers: { Cookie: cookie } },
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items.some((i) => i.id === target.id)).toBe(true);

    const renameRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${target.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          action: "change_username",
          username: "usuariorenomeado",
        }),
      },
    );
    expect(renameRes.status).toBe(200);
    expect((await renameRes.json()).username).toBe("usuariorenomeado");

    const emailVerifyRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${target.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          action: "change_email",
          email: "confirmado@menuspoiler.com.br",
          mode: "verify",
        }),
      },
    );
    expect(emailVerifyRes.status).toBe(202);
    const verifyBody = await emailVerifyRes.json();

    const confirmRes = await fetch(
      `${webserver.origin}/api/v1/email-changes/${verifyBody.pending_email_change.id}`,
      { method: "PATCH" },
    );
    expect(confirmRes.status).toBe(200);
    expect((await confirmRes.json()).email).toBe(
      "confirmado@menuspoiler.com.br",
    );

    // Promover e remover acesso administrativo diretamente pela ficha do usuário.
    const pendingUser = await orchestrator.createUser({
      email: "pendente@menuspoiler.com.br",
    });
    const pendingPromoteRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${pendingUser.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "grant_admin" }),
      },
    );
    expect(pendingPromoteRes.status).toBe(400);

    const promoteRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${target.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "grant_admin" }),
      },
    );
    expect(promoteRes.status).toBe(200);
    expect((await promoteRes.json()).features).toContain("admin");

    const selfDemoteRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${admin.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "revoke_admin" }),
      },
    );
    expect(selfDemoteRes.status).toBe(400);

    const demoteRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${target.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "revoke_admin" }),
      },
    );
    expect(demoteRes.status).toBe(200);
    expect((await demoteRes.json()).features).not.toContain("admin");

    // Impede autoexclusão pelo painel.
    const selfDeleteRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${admin.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );
    expect(selfDeleteRes.status).toBe(400);

    const eraseRes = await fetch(
      `${webserver.origin}/api/v1/admin/users/${target.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );
    expect(eraseRes.status).toBe(200);

    const logs = await database.query({
      text: "SELECT action FROM audit_logs WHERE target_user_id = $1;",
      values: [target.id],
    });
    const actions = logs.rows.map((r) => r.action);
    expect(actions).toContain("admin.user_username_changed");
    expect(actions).toContain("admin.user_email_change_requested");
    expect(actions).toContain("admin.user_promoted");
    expect(actions).toContain("admin.user_demoted");
    expect(actions).toContain("user.email_changed");
    expect(actions).toContain("admin.user_erased");
  });
});
