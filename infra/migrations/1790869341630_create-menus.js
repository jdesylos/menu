// O cardápio de um lugar, como o aplicativo o manda depois da revisão.
//
// # Por que três tabelas, e não um documento
//
// O produto é saber o prato e o preço antes de chegar: procurar "feijoada" nos
// lugares por perto, comparar preço entre duas casas. Com o cardápio guardado
// num JSON só, isso seria consulta dentro de documento, e migrar depois é
// retrabalho. Cardápio, seção e prato são linhas, e o preço é número.
//
// # Cada envio é um cardápio novo
//
// Nada aqui é atualizado: fotografar de novo cria outro `menus`, e o que vale
// para o lugar é o mais recente. Os anteriores ficam, porque são o registro de
// quem mandou o quê — e porque o aplicativo lê com um modelo de visão, que pode
// inventar um preço; o envio seguinte não pode apagar a prova do anterior.
//
// # Dinheiro é inteiro
//
// `price_cents`, em centavos, como o `Price` do aplicativo. A moeda é do
// cardápio, e não de cada prato: uma folha não mistura moedas.
//
// # O que pode faltar
//
// Só o nome do prato é obrigatório. Preço e ingredientes faltam o tempo todo
// em cardápio de verdade ("sob consulta", prato sem descrição), e exigir os
// três obrigaria a inventar valor para poder guardar. O título da seção pode
// ser vazio: é a folha que começa com pratos antes de qualquer cabeçalho.
exports.up = (pgm) => {
  pgm.createTable("menus", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    // Sem `ON DELETE`: lugar não é apagado, é ocultado — ver a migration
    // "ocultar-places-em-vez-de-apagar". O cardápio de um lugar oculto fica.
    place_id: {
      type: "uuid",
      notNull: true,
      references: "places",
    },

    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
    },

    // ISO 4217.
    currency: {
      type: "varchar(3)",
      notNull: true,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },
  });

  // As três que o aplicativo conhece — ver `menu::Currency` lá.
  pgm.addConstraint("menus", "menus_currency_check", {
    check: "currency IN ('BRL', 'USD', 'EUR')",
  });

  // "O cardápio deste lugar" é o mais recente dele.
  pgm.createIndex("menus", ["place_id", { name: "created_at", sort: "DESC" }]);

  // "Os meus cardápios", de quem mandou.
  pgm.createIndex("menus", "created_by");

  pgm.createTable("menu_sections", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    menu_id: {
      type: "uuid",
      notNull: true,
      references: "menus",
      onDelete: "CASCADE",
    },

    // A ordem da folha, a partir de zero.
    position: {
      type: "integer",
      notNull: true,
    },

    title: {
      type: "varchar(200)",
      notNull: true,
      default: "",
    },
  });

  pgm.addConstraint("menu_sections", "menu_sections_position_unique", {
    unique: ["menu_id", "position"],
  });

  pgm.createTable("menu_items", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    section_id: {
      type: "uuid",
      notNull: true,
      references: "menu_sections",
      onDelete: "CASCADE",
    },

    // A ordem dentro da seção, a partir de zero.
    position: {
      type: "integer",
      notNull: true,
    },

    name: {
      type: "varchar(200)",
      notNull: true,
    },

    // Como estava escrito na folha, numa linha só. Texto, e não lista: quem
    // quiser separar ingrediente separa depois, com o original à mão.
    ingredients: {
      type: "varchar(1000)",
      notNull: false,
    },

    price_cents: {
      type: "bigint",
      notNull: false,
    },
  });

  pgm.addConstraint("menu_items", "menu_items_position_unique", {
    unique: ["section_id", "position"],
  });

  pgm.addConstraint("menu_items", "menu_items_price_check", {
    check: "price_cents IS NULL OR price_cents >= 0",
  });
};

exports.down = false;
