// Os estabelecimentos que o mapa do aplicativo mostra.
//
// A tabela existe porque o basemap não basta: os POIs que vêm no tile da
// Protomaps saem do OpenStreetMap, e a cobertura dele na periferia é escassa —
// num raio de 1 km na zona leste de São Paulo o OSM tinha UM estabelecimento,
// enquanto o Overture Places tinha 229 no mesmo lugar.
//
// O dado é carregado por `infra/scripts/import-places.js` a partir do Overture
// Maps (CDLA-Permissive 2.0), e atualizado quando sai o release mensal deles.
exports.up = (pgm) => {
  pgm.createTable("places", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    // De onde o registro veio. Hoje só "overture", mas o campo existe desde já
    // porque a chave de atualização é (source, source_id): sem ele, trocar de
    // fonte ou somar uma segunda obrigaria a recarregar a tabela inteira.
    source: {
      type: "varchar(30)",
      notNull: true,
    },

    // O id do lugar NA FONTE — no Overture, o GERS. É o que faz o próximo
    // release atualizar o registro em vez de duplicá-lo.
    source_id: {
      type: "text",
      notNull: true,
    },

    name: {
      type: "text",
      notNull: true,
    },

    // A categoria como a fonte a publica ("restaurant", "pizza_restaurant",
    // "bar"). Guardada crua de propósito: normalizar aqui congelaria a nossa
    // interpretação dentro do banco, e é o aplicativo que decide o que vira
    // ícone de garfo.
    category: {
      type: "text",
      notNull: false,
    },

    latitude: {
      type: "double precision",
      notNull: true,
    },

    longitude: {
      type: "double precision",
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

  // A chave da recarga: o import roda de novo a cada release do Overture e
  // atualiza o que mudou, em vez de acumular cópias do mesmo lugar.
  pgm.addConstraint("places", "places_source_source_id_unique", {
    unique: ["source", "source_id"],
  });

  // A consulta do aplicativo é sempre "o que existe dentro desta caixa de
  // lat/lon" — um tile. Sem PostGIS de propósito: a extensão precisa ser
  // habilitada no Neon e não paga por si num retângulo simples, que um índice
  // composto resolve.
  pgm.createIndex("places", ["latitude", "longitude"]);
};

exports.down = false;
