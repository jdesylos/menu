// A gravação dos lugares, dividida pelas duas cargas: a do Overture
// (`import-places.mjs`) e a dos lugares acrescentados à mão
// (`import-manual-places.mjs`).
//
// Uma só porque a lista de colunas é uma só: duas cópias do INSERT divergiriam
// no dia em que a tabela ganhasse uma coluna e alguém lembrasse de uma delas.

// Os campos de um lugar, na ordem das colunas do INSERT.
const FIELDS = [
  "sourceId",
  "name",
  "category",
  "latitude",
  "longitude",
  "neighborhood",
  "street",
  "postcode",
  "locality",
  "region",
];

// Quantos parâmetros cada linha ocupa no INSERT — a fonte mais os campos.
// Contar aqui em vez de escrever o número faz a conta acompanhar a lista
// quando ela crescer de novo.
const PARAMS_PER_ROW = 1 + FIELDS.length;

// Os motivos de ocultar que são da própria carga — ver a migration
// "ocultar-places-em-vez-de-apagar". Um lugar oculto por um deles que volta a
// vir no dado volta ao mapa: o Foursquare deixou de dizer que fechou, o
// Overture o publicou de novo, a regra de duplicata deixou de casá-lo. Motivo
// de outra origem fica: a carga não desfaz o que ela não fez.
const LOAD_REASONS = ["closed", "duplicate", "missing_from_source"];

// Grava os lugares de UMA fonte, atualizando os que já existem.
//
// A chave é (source, source_id): o mesmo lugar carregado de novo atualiza a
// linha em vez de duplicá-la. Cabe ao chamador não passar lotes grandes
// demais — ver o BATCH_SIZE do `import-places.mjs`.
export async function upsertPlaces(client, source, places) {
  const values = [];
  const rows = places.map((place, index) => {
    const offset = index * PARAMS_PER_ROW;
    values.push(source, ...FIELDS.map((field) => place[field]));

    const params = Array.from(
      { length: PARAMS_PER_ROW },
      (_, i) => `$${offset + i + 1}`,
    );

    return `(${params.join(", ")})`;
  });

  await client.query({
    text: `
      INSERT INTO
        places (
          source, source_id, name, category, latitude, longitude,
          neighborhood, street, postcode, locality, region
        )
      VALUES
        ${rows.join(", ")}
      ON CONFLICT
        (source, source_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        neighborhood = EXCLUDED.neighborhood,
        street = EXCLUDED.street,
        postcode = EXCLUDED.postcode,
        locality = EXCLUDED.locality,
        region = EXCLUDED.region,
        hidden_at = CASE
          WHEN places.hidden_reason = ANY($${values.length + 1}::text[]) THEN NULL
          ELSE places.hidden_at
        END,
        hidden_reason = CASE
          WHEN places.hidden_reason = ANY($${values.length + 1}::text[]) THEN NULL
          ELSE places.hidden_reason
        END,
        duplicate_of = CASE
          WHEN places.hidden_reason = ANY($${values.length + 1}::text[]) THEN NULL
          ELSE places.duplicate_of
        END,
        updated_at = timezone('utc', now())
    ;`,
    values: [...values, LOAD_REASONS],
  });
}
