import database from "infra/database.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function record({
  action,
  actorUserId,
  targetUserId,
  ip,
  metadata = null,
}) {
  try {
    await database.query({
      text: `
        INSERT INTO
          audit_logs (action, actor_user_id, target_user_id, ip, metadata)
        VALUES
          ($1, $2, $3, $4, $5::jsonb)
      ;`,
      values: [
        action,
        actorUserId || null,
        targetUserId || null,
        ip || null,
        JSON.stringify(metadata || {}),
      ],
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

async function findByUserId(userId, { limit = 50 } = {}) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return [];
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const results = await database.query({
    text: `
      SELECT
        id,
        actor_user_id,
        target_user_id,
        action,
        metadata,
        created_at
      FROM
        audit_logs
      WHERE
        actor_user_id = $1
        OR target_user_id = $1
      ORDER BY
        created_at DESC
      LIMIT
        $2
    ;`,
    values: [userId, safeLimit],
  });

  return results.rows;
}

const auditLog = {
  record,
  findByUserId,
};

export default auditLog;
