// Os links de "esqueci a senha".
//
// O mesmo desenho dos links de ativação (`user_activation_tokens`): o id é o
// token — um UUID aleatório, que vai no link do email —, e a linha diz de
// quem ele é, até quando vale e se já foi usado. Tabela própria, e não uma
// coluna de tipo na de ativação: os dois links dão poderes diferentes, e um
// token de ativação não pode, por engano de consulta, trocar uma senha.
//
// O token vale por pouco tempo e uma vez só — ver `models/recovery.js`.
exports.up = (pgm) => {
  pgm.createTable("password_recovery_tokens", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    used_at: {
      type: "timestamptz",
      notNull: false,
    },

    user_id: {
      type: "uuid",
      notNull: true,
    },

    expires_at: {
      type: "timestamptz",
      notNull: true,
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

  // Apagar a conta e trocar a senha procuram os links de UMA conta.
  pgm.createIndex("password_recovery_tokens", "user_id");
};

exports.down = false;
