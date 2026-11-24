// Promove manualmente um usuário existente ao painel administrativo (`1.1`),
// atribuindo todas as permissões do aplicativo e do painel.
//
// Uso: npm run admin:promote -- <email_ou_username>
import database from "../database.js";
import { ALL_ADMIN_FEATURES } from "../../models/features.js";

const targetIdentifier = process.argv[2]?.trim();

if (!targetIdentifier) {
  console.error(
    "Informe o email ou username do usuário: npm run admin:promote -- <email_ou_username>",
  );
  process.exit(1);
}

const ADMIN_FEATURES = ALL_ADMIN_FEATURES;

async function main() {
  const client = await database.getNewClient();

  try {
    const result = await client.query({
      text: `
        UPDATE
          users
        SET
          features = (
            SELECT ARRAY(
              SELECT DISTINCT feature
              FROM unnest(features || $2::text[]) AS feature
              WHERE feature <> 'read:activation_token'
            )
          ),
          updated_at = timezone('utc', now())
        WHERE
          (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1))
          AND deleted_at IS NULL
        RETURNING
          id, username, email, features
      ;`,
      values: [targetIdentifier, ADMIN_FEATURES],
    });

    if (result.rowCount === 0) {
      console.error(`Usuário ativo "${targetIdentifier}" não encontrado.`);
      process.exitCode = 1;
      return;
    }

    const updated = result.rows[0];
    console.log(
      `Admin promovido: ${updated.username} (${updated.email}) [${updated.id}]`,
    );
  } finally {
    await client.end();
  }
}

main();
