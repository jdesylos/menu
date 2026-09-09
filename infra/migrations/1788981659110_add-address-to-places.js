// Onde o estabelecimento fica, em palavras, e o índice que faz procurá-lo por
// nome ser barato.
//
// # Por que endereço
//
// A busca do aplicativo sugere lugares enquanto a pessoa digita, e nome sozinho
// não identifica ninguém: há dezenas de "Bar do Zé" no país e três "Casa do Pão
// de Queijo" no mesmo bairro. O que distingue um do outro na lista é a linha de
// baixo — bairro e cidade.
//
// # De onde o dado vem
//
// Do mesmo Overture que já traz o lugar. `locality` e `region` são campos do
// endereço publicado (cidade e estado); `neighborhood` NÃO é — ele sai de um
// cruzamento espacial com o tema `divisions`, feito no import: o ponto do
// estabelecimento dentro do polígono do bairro. Medido no release 2026-08-19.0,
// a cobertura em São Paulo é de 100%.
//
// Os três aceitam nulo de propósito. Cidade pequena pode não ter polígono de
// bairro no Overture, e endereço incompleto é melhor que estabelecimento
// ausente — quem procura por nome ainda encontra.
exports.up = (pgm) => {
  // Bairro. Vem do polígono mais ESPECÍFICO que contém o ponto — ver o
  // `import-places.sh`, que escolhe entre microhood, neighborhood e macrohood.
  pgm.addColumn("places", {
    neighborhood: { type: "text", notNull: false },
  });

  // Cidade e estado, como o Overture os publica em `addresses[1]`. Guardados
  // crus, como a categoria: normalizar "São Paulo" para uma tabela de
  // municípios é trabalho que só se paga quando houver filtro por cidade, e
  // hoje o que existe é uma linha de texto embaixo do nome.
  pgm.addColumn("places", {
    locality: { type: "text", notNull: false },
    region: { type: "text", notNull: false },
  });

  // A busca é por PEDAÇO do nome: quem digita "boteco" espera achar "Boteco do
  // Zé" e "O Boteco". Isso é `ILIKE '%boteco%'`, que sem índice de trigrama
  // varre a tabela inteira a cada tecla digitada — centenas de milhares de
  // linhas por requisição, e são várias requisições por palavra.
  //
  // `pg_trgm` está disponível no Neon e no Postgres do compose, e é a extensão
  // que o índice GIN abaixo usa para responder a `ILIKE` sem varredura.
  pgm.createExtension("pg_trgm", { ifNotExists: true });
  pgm.createIndex("places", "name", {
    name: "places_name_trgm_index",
    method: "gin",
    opclass: "gin_trgm_ops",
  });
};

// Como as outras: o caminho de volta é restaurar o banco, não desfazer coluna
// por coluna.
exports.down = false;
