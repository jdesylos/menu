// Solicitações e pedidos de ajuda da Cláusula 1.2 ("Não encontro o local",
// ajuda geral e ajuda relacionada à conta).
//
// Fica separado de `place_suggestions` porque pedidos de atendimento podem ser
// enviados sem login (quando a pessoa não consegue entrar na conta), não exigem
// coordenadas nem endereço estruturado completo e nunca publicam um local
// automaticamente sem conferência da equipe no painel.
exports.up = (pgm) => {
  pgm.createTable("support_requests", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    category: {
      type: "varchar(32)",
      notNull: true,
    },

    status: {
      type: "varchar(24)",
      notNull: true,
      default: "open",
    },

    user_id: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },

    contact_name: {
      type: "varchar(120)",
      notNull: false,
    },

    contact_email: {
      type: "varchar(254)",
      notNull: false,
    },

    // Identificador livre informado por quem pede ajuda de conta sem login
    // (ex.: username ou e-mail antigo). Nunca armazena senha.
    account_identifier: {
      type: "varchar(254)",
      notNull: false,
    },

    subject: {
      type: "varchar(200)",
      notNull: false,
    },

    message: {
      type: "text",
      notNull: false,
    },

    place_name: {
      type: "varchar(200)",
      notNull: false,
    },

    approximate_address: {
      type: "varchar(400)",
      notNull: false,
    },

    latitude: {
      type: "double precision",
      notNull: false,
    },

    longitude: {
      type: "double precision",
      notNull: false,
    },

    metadata: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },

    resolved_place_id: {
      type: "uuid",
      notNull: false,
      references: "places",
      onDelete: "SET NULL",
    },

    handled_by: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },

    resolution_note: {
      type: "text",
      notNull: false,
    },

    handled_at: {
      type: "timestamptz",
      notNull: false,
    },

    resolved_at: {
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

  pgm.addConstraint("support_requests", "support_requests_category_check", {
    check: "category IN ('missing_place', 'general_help', 'account_help')",
  });

  pgm.addConstraint("support_requests", "support_requests_status_check", {
    check: "status IN ('open', 'in_progress', 'resolved', 'archived')",
  });

  pgm.addConstraint(
    "support_requests",
    "support_requests_coordinates_pair_check",
    {
      check: "(latitude IS NULL) = (longitude IS NULL)",
    },
  );

  pgm.createIndex("support_requests", [
    "status",
    { name: "created_at", sort: "DESC" },
  ]);

  pgm.createIndex("support_requests", [
    "category",
    "status",
    { name: "created_at", sort: "DESC" },
  ]);

  pgm.createIndex(
    "support_requests",
    ["user_id", { name: "created_at", sort: "DESC" }],
    {
      name: "support_requests_user_id_idx",
      where: "user_id IS NOT NULL",
    },
  );

  // Backfill da permissão de atendimento em contas administrativas existentes.
  pgm.sql(`
    UPDATE
      users
    SET
      features = array_append(features, 'manage:support'),
      updated_at = timezone('utc', now())
    WHERE
      'admin' = ANY(features)
      AND NOT ('manage:support' = ANY(features))
  ;`);
};

exports.down = false;
