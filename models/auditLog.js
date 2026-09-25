import database from "infra/database.js";

async function record({ action, actorUserId, targetUserId, ip }) {
  try {
    await database.query({
      text: `
        INSERT INTO
          audit_logs (action, actor_user_id, target_user_id, ip)
        VALUES
          ($1, $2, $3, $4)
      ;`,
      values: [action, actorUserId || null, targetUserId || null, ip || null],
    });
  } catch (error) {
    // Audit log nunca deve quebrar o fluxo principal.
    // Apenas registra falha no console (sanitizado, sem cause chain).
    console.error({
      name: "AuditLogWriteError",
      action,
      underlyingErrorName: error?.name,
    });
  }
}

const auditLog = {
  record,
};

export default auditLog;
