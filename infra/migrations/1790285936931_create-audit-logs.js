// O registro do que aconteceu com as contas — ver `models/auditLog.js`.
//
// Mesma tabela do repositório judhagsan. Aqui começa pelo login (sessão criada,
// recusada, encerrada): com o limite de tentativas, é o que permite ver depois
// quem tentou entrar em qual conta, e de onde.
exports.up = (pgm) => {
  pgm.createTable("audit_logs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    actor_user_id: {
      type: "uuid",
      notNull: false,
    },

    target_user_id: {
      type: "uuid",
      notNull: false,
    },

    action: {
      type: "varchar(64)",
      notNull: true,
    },

    ip: {
      type: "varchar(45)",
      notNull: false,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },
  });

  pgm.createIndex("audit_logs", "actor_user_id");
  pgm.createIndex("audit_logs", "target_user_id");
  pgm.createIndex("audit_logs", "action");
  pgm.createIndex("audit_logs", "created_at");
};

exports.down = false;
