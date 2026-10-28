// O cardápio que substitui outro: de qual ele saiu, e de onde foi fotografado.
//
// Até aqui um lugar recebia um cardápio só. Agora o que vale pode ser trocado
// — ver `menu.create` —, e cada troca continua sendo uma linha nova em `menus`:
// a anterior fica, como registro. Estas duas colunas são o que permite ler
// esse registro depois, e voltar atrás numa troca que não devia ter
// acontecido.
//
// Nenhuma das duas sai na resposta da API.
exports.up = (pgm) => {
  pgm.addColumns("menus", {
    // O cardápio que valia quando este foi mandado, e que ele substituiu.
    // Nulo no primeiro cardápio do lugar. Sem `ON DELETE`: cardápio não é
    // apagado.
    replaces_menu_id: {
      type: "uuid",
      notNull: false,
      references: "menus",
    },

    // A que distância do lugar estava quem fotografou, em metros. Nulo quando
    // ninguém fotografou — quem mandou o cardápio mudando o texto dele — e no
    // primeiro cardápio, que não pede posição. Só a distância, e não a
    // posição: ela basta para conferir a troca, e a posição de alguém num
    // instante não é dado que o servidor precise guardar.
    distance_m: {
      type: "integer",
      notNull: false,
    },
  });

  pgm.addConstraint("menus", "menus_distance_m_check", {
    check: "distance_m IS NULL OR distance_m >= 0",
  });
};

exports.down = false;
