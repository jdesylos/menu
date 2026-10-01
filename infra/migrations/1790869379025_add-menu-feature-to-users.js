// A feature de cardápio para quem já existe — ver `models/authorization.js`.
//
// A ativação passa a dar `create:menu`, mas só a quem ativar DEPOIS desta
// versão. Quem já estava ativado recebe aqui. "Ativado" é quem tem
// `create:session`, que é o que a ativação dá desde sempre.
//
// Idempotente pelo NOT ... = ANY, porque o banco de preview pode estar em
// qualquer ponto do histórico.
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE
      users
    SET
      features = array_append(features, 'create:menu'),
      updated_at = timezone('utc', now())
    WHERE
      'create:session' = ANY(features)
      AND NOT ('create:menu' = ANY(features))
  `);
};

exports.down = false;
