// Lugar que sai do mapa passa a ser OCULTADO, e não apagado.
//
// # Por que agora
//
// A carga apagava os lugares que o Foursquare dá como fechados, e o próximo
// passo seria apagar também as duplicatas. Enquanto o banco só guardava o que
// o Overture publica, apagar não custava nada: a linha voltava na carga
// seguinte, se fosse o caso. Isso deixa de valer quando o aplicativo pendurar
// coisas no lugar — cardápio, sugestão de usuário. Apagar o lugar levaria
// junto o que foi pendurado nele, e fundir duas duplicatas exige saber qual
// sobrou, para mover para ela o que estava na outra.
//
// # O que muda
//
// - `hidden_at`: quando o lugar saiu do mapa. Nulo é visível — e é o que as
//   rotas de tile e de busca passam a exigir.
// - `hidden_reason`: por quê. Os três motivos de hoje são todos da carga:
//   - `closed`: o Foursquare diz que fechou;
//   - `duplicate`: é o mesmo lugar que outro, e o outro ficou;
//   - `missing_from_source`: sumiu do release do Overture.
//   A carga devolve ao mapa quem ela mesma tirou, se o lugar voltar a aparecer
//   no dado. Motivo novo, de outra origem, entra com migration própria.
// - `duplicate_of`: o lugar que ficou no lugar da duplicata.
exports.up = (pgm) => {
  pgm.addColumn("places", {
    hidden_at: {
      type: "timestamptz",
      notNull: false,
    },

    hidden_reason: {
      type: "varchar(30)",
      notNull: false,
    },

    // Se o lugar que ficou for apagado de verdade um dia, a duplicata continua
    // oculta: perde só a referência, não o motivo.
    duplicate_of: {
      type: "uuid",
      notNull: false,
      references: "places",
      onDelete: "SET NULL",
    },
  });

  pgm.addConstraint("places", "places_hidden_reason_check", {
    check: "hidden_reason IN ('closed', 'duplicate', 'missing_from_source')",
  });

  // Oculto sem motivo, ou motivo num lugar visível, é dado que ninguém sabe
  // interpretar.
  pgm.addConstraint("places", "places_hidden_consistency_check", {
    check: "(hidden_at IS NULL) = (hidden_reason IS NULL)",
  });

  pgm.addConstraint("places", "places_duplicate_of_check", {
    check: "duplicate_of IS NULL OR hidden_reason = 'duplicate'",
  });
};

exports.down = false;
