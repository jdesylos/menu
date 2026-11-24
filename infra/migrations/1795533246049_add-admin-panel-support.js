// Suporte ao painel administrativo web (`1.1`):
//
// - Busca paginada de estabelecimentos por nome e endereço (incluindo ocultos)
//   com índices trigram sem gastar espaço duplicado no índice de visíveis.
// - Motivo `admin_removed` em `places`, preservando ocultações administrativas
//   diante de novas cargas do Overture.
// - Metadados em `audit_logs` para registrar ações em locais, cardápios, contas
//   e futuras decisões de recuperação.
// - Confirmação de troca de e-mail (`user_email_change_tokens`).
// - Concessão das novas features granulares para contas que já tenham `admin`.
exports.up = (pgm) => {
  pgm.dropConstraint("places", "places_hidden_reason_check");
  pgm.addConstraint("places", "places_hidden_reason_check", {
    check: `hidden_reason IN (
      'closed', 'duplicate', 'missing_from_source',
      'reported_closed', 'reported_duplicate', 'admin_removed'
    )`,
  });

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS places_hidden_at_idx
    ON places (hidden_at DESC)
    WHERE hidden_at IS NOT NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS places_hidden_name_sem_acento_trgm_idx
    ON places
    USING gin (sem_acento(name) gin_trgm_ops)
    WHERE hidden_at IS NOT NULL;
  `);

  // Não usa STRICT porque colunas de endereço podem ser nulas individualmente;
  // `concat_ws` ignora nulos mantendo a função IMUTABLE para o índice GIN.
  pgm.sql(`
    CREATE FUNCTION sem_acento_endereco(
      street text,
      neighborhood text,
      locality text,
      region text,
      postcode text
    )
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      SELECT public.unaccent(
        'public.unaccent'::regdictionary,
        concat_ws(' ', street, neighborhood, locality, region, postcode)
      )
    $$;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS places_address_sem_acento_trgm_idx
    ON places
    USING gin (
      sem_acento_endereco(street, neighborhood, locality, region, postcode)
      gin_trgm_ops
    );
  `);

  pgm.addColumn("audit_logs", {
    metadata: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
  });

  pgm.createTable("user_email_change_tokens", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },

    new_email: {
      type: "varchar(254)",
      notNull: true,
    },

    requested_by: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },

    expires_at: {
      type: "timestamptz",
      notNull: true,
    },

    used_at: {
      type: "timestamptz",
      notNull: false,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },
  });

  pgm.createIndex("user_email_change_tokens", "user_id", {
    name: "user_email_change_tokens_user_id_idx",
  });
  pgm.createIndex("user_email_change_tokens", "expires_at", {
    name: "user_email_change_tokens_expires_at_idx",
  });

  for (const feature of [
    "manage:menu",
    "read:user:admin",
    "update:user:others",
    "erase:user:others",
    "manage:admins",
  ]) {
    pgm.sql(`
      UPDATE
        users
      SET
        features = array_append(features, '${feature}'),
        updated_at = timezone('utc', now())
      WHERE
        'admin' = ANY(features)
        AND NOT ('${feature}' = ANY(features))
    `);
  }
};

exports.down = false;
