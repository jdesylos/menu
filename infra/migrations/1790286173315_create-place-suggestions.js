// O que o usuário manda sobre um lugar vira uma SUGESTÃO, e só muda o mapa
// quando alguém com `manage:place` a aceita.
//
// # Por que uma fila, e não a escrita direta
//
// O mapa é o que todo mundo vê. Um restaurante cadastrado por engano, um nome
// trocado de propósito, um "fechou" de quem só passou numa segunda-feira: sem
// revisão, qualquer conta escreve no mapa de todo mundo. A fila é o lugar onde
// a revisão acontece, e o registro de quem pediu e de quem aceitou.
//
// # Os quatro tipos
//
// - `create`: um lugar que o mapa não tem. Aceito, vira um lugar de
//   `source = 'usuario'`, e `place_id` passa a apontar para ele.
// - `update`: nome, categoria, endereço ou posição de um lugar. Aceito, grava
//   em `places.overrides` — ver abaixo.
// - `close`: fechou. Aceito, oculta o lugar com `reported_closed`.
// - `duplicate`: é o mesmo que outro. Aceito, oculta o lugar com
//   `reported_duplicate`, apontando para o outro.
//
// # `places.overrides`
//
// A carga do Overture reescreve nome, endereço e posição a cada release. Uma
// correção gravada só nas colunas sumiria na carga seguinte. `overrides`
// guarda o que foi corrigido, e a carga reaplica por cima do que o Overture
// mandar — ver `places-upsert.mjs`. As colunas continuam tendo o valor que
// vale, e é por isso que busca, tile e índices não mudam.
//
// # Os motivos novos de ocultar
//
// `reported_closed` e `reported_duplicate` são decisões de gente, e a carga não
// os desfaz — ao contrário de `closed` e `duplicate`, que ela mesma decide e
// revê a cada release.
exports.up = (pgm) => {
  pgm.addColumn("places", {
    overrides: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },
  });

  pgm.dropConstraint("places", "places_hidden_reason_check");
  pgm.addConstraint("places", "places_hidden_reason_check", {
    check: `hidden_reason IN (
      'closed', 'duplicate', 'missing_from_source',
      'reported_closed', 'reported_duplicate'
    )`,
  });

  pgm.dropConstraint("places", "places_duplicate_of_check");
  pgm.addConstraint("places", "places_duplicate_of_check", {
    check: `duplicate_of IS NULL
      OR hidden_reason IN ('duplicate', 'reported_duplicate')`,
  });

  pgm.createTable("place_suggestions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    kind: {
      type: "varchar(20)",
      notNull: true,
    },

    // O lugar de que se fala. Nulo só no `create` ainda não aceito: o lugar
    // nasce na aceitação.
    place_id: {
      type: "uuid",
      notNull: false,
      references: "places",
      onDelete: "SET NULL",
    },

    // Do que ele é duplicata, no `duplicate`.
    duplicate_of: {
      type: "uuid",
      notNull: false,
      references: "places",
      onDelete: "SET NULL",
    },

    // Os campos, no `create` e no `update`. Só os campos que existem em
    // `places` — ver `models/placeSuggestion.js`.
    changes: {
      type: "jsonb",
      notNull: true,
      default: "{}",
    },

    status: {
      type: "varchar(20)",
      notNull: true,
      default: "pending",
    },

    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
    },

    reviewed_by: {
      type: "uuid",
      notNull: false,
      references: "users",
    },

    reviewed_at: {
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

  pgm.addConstraint("place_suggestions", "place_suggestions_kind_check", {
    check: "kind IN ('create', 'update', 'close', 'duplicate')",
  });

  pgm.addConstraint("place_suggestions", "place_suggestions_status_check", {
    check: "status IN ('pending', 'accepted', 'rejected')",
  });

  pgm.addConstraint("place_suggestions", "place_suggestions_reviewed_check", {
    check: "(status = 'pending') = (reviewed_at IS NULL)",
  });

  // A fila de quem revisa: as pendentes, das mais antigas para as novas.
  pgm.createIndex("place_suggestions", ["status", "created_at"]);
  // "As minhas sugestões", de quem mandou.
  pgm.createIndex("place_suggestions", "created_by");
};

exports.down = false;
