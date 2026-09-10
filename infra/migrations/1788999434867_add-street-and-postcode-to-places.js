// O resto do endereço: a rua com número, e o CEP.
//
// # Por que agora
//
// O aplicativo abre um painel quando se toca no marcador do restaurante, e ali
// o endereço é o conteúdo — bairro e cidade respondem "qual dos três Bar do
// Zé", mas não respondem "como eu chego". Rua e número respondem.
//
// # De onde vem
//
// Do mesmo `addresses[1]` do Overture que já dava cidade e estado:
// `freeform` traz a rua com o número, `postcode` traz o CEP. Os dois já
// estavam no Parquet que o import lê — eram descartados no SELECT.
//
// `freeform` é texto livre, e é assim que ele chega: "Rua Treze de Maio, 739"
// na maioria dos casos, mas também "Rua 13 de Maio 540 - Bela Vista / Bixiga",
// com o bairro embutido. Normalizar isso seria adivinhar formato de endereço
// brasileiro dentro de uma migration; o aplicativo mostra o que veio.
exports.up = (pgm) => {
  pgm.addColumn("places", {
    // A rua com número, como a fonte publica. `street` e não `freeform`
    // porque o nome da coluna descreve o CONTEÚDO, não a origem dele.
    street: { type: "text", notNull: false },

    // O CEP. Texto, e não número: CEP começa com zero em metade do país, e o
    // hífen faz parte de como ele se escreve.
    postcode: { type: "text", notNull: false },
  });
};

exports.down = false;
