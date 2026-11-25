// Cria ou atualiza a credencial administrativa de testes apenas no ambiente
// de desenvolvimento local. Nunca executa em produção.
import bcryptjs from "bcryptjs";
import database from "../database.js";
import { ALL_ADMIN_FEATURES } from "../../models/features.js";

export const DEV_ADMIN = {
  username: "admin",
  email: "admin@menuspoiler.local",
  password: "devadminpassword",
};

const ALL_FEATURES = ALL_ADMIN_FEATURES;

export async function ensureDevAdmin({ client = null } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed de admin de desenvolvimento bloqueado em produção.");
  }

  const db = client || database;
  const hashedPassword = await bcryptjs.hash(DEV_ADMIN.password, 1);

  const existing = await db.query({
    text: `
      SELECT id
      FROM users
      WHERE (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2))
        AND deleted_at IS NULL
      LIMIT 1
    ;`,
    values: [DEV_ADMIN.email, DEV_ADMIN.username],
  });

  if (existing.rowCount > 0) {
    const updated = await db.query({
      text: `
        UPDATE
          users
        SET
          username = $2,
          email = $3,
          password = $4,
          features = $5,
          updated_at = timezone('utc', now())
        WHERE
          id = $1
        RETURNING
          id, username, email, features, created_at, updated_at
      ;`,
      values: [
        existing.rows[0].id,
        DEV_ADMIN.username,
        DEV_ADMIN.email,
        hashedPassword,
        ALL_FEATURES,
      ],
    });
    return updated.rows[0];
  }

  const created = await db.query({
    text: `
      INSERT INTO
        users (username, email, password, features)
      VALUES
        ($1, $2, $3, $4)
      RETURNING
        id, username, email, features, created_at, updated_at
    ;`,
    values: [DEV_ADMIN.username, DEV_ADMIN.email, hashedPassword, ALL_FEATURES],
  });

  return created.rows[0];
}

const isDirectExecution =
  process.argv[1] && process.argv[1].endsWith("seed-dev-admin.mjs");

if (isDirectExecution) {
  database
    .getNewClient()
    .then(async (client) => {
      try {
        const adminUser = await ensureDevAdmin({ client });
        console.log(
          `Admin de desenvolvimento pronto: ${adminUser.email} / ${DEV_ADMIN.password}`,
        );
      } finally {
        await client.end();
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
