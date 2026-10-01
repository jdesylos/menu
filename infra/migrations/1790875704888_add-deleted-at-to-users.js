// A conta pode ser APAGADA por quem é dona dela, pelo aplicativo.
//
// # Apagar é esvaziar, e não remover a linha
//
// Os cardápios que a conta mandou continuam valendo para os lugares: o
// cardápio é do lugar, e não de quem o fotografou. Eles apontam para a conta
// (`menus.created_by`), e as sugestões de lugar também. Remover a linha
// obrigaria a deixar esse autor nulo nas duas tabelas, e aí não se saberia
// mais que vinte cardápios vieram da MESMA conta — que é o que permite limpar
// de uma vez o que uma conta abusiva mandou.
//
// Então a linha fica, vazia: nome de usuário, email e senha viram nulos, as
// features somem, e `deleted_at` diz quando. O que resta é um id e duas datas,
// que não identificam ninguém.
//
// # Por que as três colunas deixam de ser NOT NULL
//
// Nulo é o que "apagado" quer dizer aqui. Um valor de mentira no lugar — um
// email inventado, um nome "removido-123" — seria dado falso guardado como
// verdadeiro, e ocuparia para sempre um nome que alguém pode querer. Com nulo,
// o email e o nome de usuário ficam livres na hora: o índice único não conta
// nulos.
//
// A garantia que o NOT NULL dava continua, na restrição abaixo: conta viva tem
// os três; conta apagada não tem nenhum. Não existe conta pela metade.
exports.up = (pgm) => {
  pgm.addColumn("users", {
    deleted_at: {
      type: "timestamptz",
      notNull: false,
    },
  });

  pgm.alterColumn("users", "username", { notNull: false });
  pgm.alterColumn("users", "email", { notNull: false });
  pgm.alterColumn("users", "password", { notNull: false });

  pgm.addConstraint("users", "users_deleted_consistency_check", {
    check: `(
      deleted_at IS NULL
      AND username IS NOT NULL
      AND email IS NOT NULL
      AND password IS NOT NULL
    ) OR (
      deleted_at IS NOT NULL
      AND username IS NULL
      AND email IS NULL
      AND password IS NULL
    )`,
  });
};

exports.down = false;
