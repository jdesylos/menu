// A janela de tentativas por IP — ver `models/rateLimit.js`.
//
// Mesma tabela do repositório judhagsan, de onde veio o limite de login: uma
// linha por identificador ("login:<ip>"), com a contagem da janela corrente.
//
// O limite conhecido: nada limpa as linhas antigas ainda. Lá quem limpa é um
// cron diário; aqui a tabela só cresce com IPs novos que tentam entrar, e o
// índice abaixo é o que o cron vai usar quando vier.
exports.up = (pgm) => {
  pgm.createTable("rate_limits", {
    identifier: {
      type: "varchar(255)",
      primaryKey: true,
    },

    count: {
      type: "integer",
      notNull: true,
      default: 1,
    },

    window_started_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },
  });

  // Index para limpeza periódica de registros antigos
  pgm.createIndex("rate_limits", "window_started_at");
};

exports.down = false;
