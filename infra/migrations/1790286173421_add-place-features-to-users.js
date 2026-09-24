// As features de lugar para quem já existe — ver `models/authorization.js`.
//
// A ativação passa a dar `create:place` e `update:place`, mas só a quem
// ativar DEPOIS desta versão. Quem já estava ativado recebe aqui. "Ativado" é
// quem tem `create:session`, que é o que a ativação dá desde sempre.
//
// E `manage:place` vai para quem tem `admin`, como no repositório judhagsan:
// `admin` não concede nada sozinho, e é esta linha, explícita, que dá o poder
// de aceitar sugestões — e é ela que alguém precisa reverter para tirá-lo.
// Concessão nova é manual: `user.addFeatures(id, ["admin", "manage:place"])`.
//
// Idempotente pelo NOT ... = ANY, porque o banco de preview pode estar em
// qualquer ponto do histórico.
exports.up = (pgm) => {
  for (const feature of ["create:place", "update:place"]) {
    pgm.sql(`
      UPDATE
        users
      SET
        features = array_append(features, '${feature}'),
        updated_at = timezone('utc', now())
      WHERE
        'create:session' = ANY(features)
        AND NOT ('${feature}' = ANY(features))
    `);
  }

  pgm.sql(`
    UPDATE
      users
    SET
      features = array_append(features, 'manage:place'),
      updated_at = timezone('utc', now())
    WHERE
      'admin' = ANY(features)
      AND NOT ('manage:place' = ANY(features))
  `);
};

exports.down = false;
