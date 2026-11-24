// Índices faltantes e índices parciais para reduzir varreduras no banco:
//
// - `sessions(user_id)` e `user_activation_tokens(user_id)` evitam varredura
//   sequencial ao apagar a conta, trocar senha ou recuperar acesso.
// - `sessions(expires_at)` apoia a limpeza periódica de sessões vencidas.
// - Índices funcionais em `LOWER(username)` e `LOWER(email)` sustentam a
//   checagem case-insensitive do cadastro e do login sem falhar caso haja
//   dados legados.
// - Índices parciais em `places` (`WHERE hidden_at IS NULL`) excluem lugares
//   ocultos (fechados, duplicatas, ausentes) da busca por tile e da busca por
//   nome, reduzindo tamanho em memória e heap fetches.
// - Índices de cobertura em `menus` evitam sort extra no `DISTINCT ON` da
//   listagem pública e de "Meus cardápios".
exports.up = (pgm) => {
  pgm.createIndex("sessions", "user_id", {
    name: "sessions_user_id_idx",
    ifNotExists: true,
  });

  pgm.createIndex("sessions", "expires_at", {
    name: "sessions_expires_at_idx",
    ifNotExists: true,
  });

  pgm.createIndex("user_activation_tokens", "user_id", {
    name: "user_activation_tokens_user_id_idx",
    ifNotExists: true,
  });

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS users_lower_username_idx
    ON users (LOWER(username))
    WHERE username IS NOT NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS users_lower_email_idx
    ON users (LOWER(email))
    WHERE email IS NOT NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS places_visible_lat_lon_idx
    ON places (latitude, longitude)
    WHERE hidden_at IS NULL;
  `);

  pgm.sql(`
    DROP INDEX IF EXISTS places_name_sem_acento_trgm_index;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS places_visible_name_sem_acento_trgm_idx
    ON places
    USING gin (sem_acento(name) gin_trgm_ops)
    WHERE hidden_at IS NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS menus_place_latest_idx
    ON menus (place_id, created_at DESC, id DESC);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS menus_creator_latest_idx
    ON menus (created_by, place_id, created_at DESC, id DESC);
  `);
};

exports.down = false;
