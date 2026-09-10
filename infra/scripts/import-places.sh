#!/usr/bin/env bash
#
# Carrega no banco os estabelecimentos do Brasil, do Overture Maps.
#
# # Como funciona
#
# O DuckDB lê o GeoParquet do Overture direto no S3 e aplica o filtro LÁ,
# trazendo só as cinco colunas que interessam e só as linhas de comida do
# Brasil. O resultado sai um CSV de ~100 MB, que o `import-places.mjs` carrega.
#
# A alternativa óbvia — o CLI `overturemaps` com `--bbox` — baixa tudo o que cai
# na caixa (farmácia, dentista, igreja, com todas as propriedades) para filtrar
# depois, na sua máquina: cerca de 10 GB para chegar aos mesmos 100 MB. Medido,
# não estimado.
#
# # Requisitos
#
#   brew install duckdb
#
# # Uso
#
#   POSTGRES_HOST=... POSTGRES_PORT=5432 POSTGRES_USER=... \
#   POSTGRES_PASSWORD=... POSTGRES_DB=... NODE_ENV=production \
#     bash infra/scripts/import-places.sh
#
# Sem as variáveis, carrega no Postgres local do `compose.yaml`.
set -euo pipefail

# O release do Overture. Fixo, e não "o mais novo": assim duas cargas feitas em
# semanas diferentes carregam o MESMO dado, e atualizar é uma mudança de uma
# linha que fica registrada no histórico.
RELEASE="${OVERTURE_RELEASE:-2026-08-19.0}"

# A caixa de `models/tile.js` — Brasil com folga. Ela sozinha pega 1,5 milhão de
# lugares de Argentina, Chile, Colômbia e vizinhos, então o país entra como
# filtro de verdade logo abaixo; a caixa fica porque é ela que deixa o DuckDB
# pular a maior parte dos arquivos sem abrir.
OESTE=${OESTE:--75}
SUL=${SUL:--35}
LESTE=${LESTE:--32}
NORTE=${NORTE:-6}
PAIS="${PAIS:-BR}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v duckdb &>/dev/null; then
    echo "erro: duckdb não encontrado — brew install duckdb" >&2
    exit 1
fi

CSV="$(mktemp -t places).csv"
trap 'rm -f "$CSV"' EXIT

echo "[1/2] Extraindo do Overture (release $RELEASE)..."

# As categorias que contam como "onde se come".
#
# Lista EXPLÍCITA, e não casamento por pedaço de nome. A taxonomia do Overture
# tem 1508 categorias no Brasil, e procurar "bar" dentro do nome traz `barber`
# (70 mil barbearias); procurar "pub" traz `public_school` e `notary_public`.
# O sufixo `_restaurant` é a única regra por padrão, e é segura: as 118
# categorias que terminam assim são todas cozinha.
#
# Ficam DE FORA de propósito: `health_food_store` e `specialty_foods` (são
# loja), `food_delivery_service` (não tem salão para visitar) e
# `food_beverage_service_distribution` (é atacado).
# O heredoc NÃO é citado de propósito — $RELEASE, $PAIS e a caixa do país
# precisam ser substituídos pelo shell antes de o DuckDB ver a consulta. O preço
# é que crase aqui dentro vira execução de comando: os comentários SQL abaixo
# usam aspas, e nunca crase.
duckdb <<SQL
INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';

-- Os bairros, do tema "divisions" do mesmo Overture.
--
-- Bairro NÃO é campo de endereço: addresses[1] traz rua, cidade, estado e
-- CEP, e o bairro só aparece — às vezes, em formato livre — dentro da rua. Como
-- linha de baixo na busca ("Bela Vista, São Paulo") ele é o que identifica o
-- lugar, então vem daqui: o polígono que contém o ponto do estabelecimento.
--
-- A caixa vem primeiro, e não é redundante com o país: é ela que deixa o
-- DuckDB pular arquivo inteiro pela estatística, sem abrir a geometria. Sem a
-- caixa, filtrar por country obriga a varrer os polígonos do mundo todo — mais
-- de um gigabyte descendo do S3 para achar os bairros do Brasil.
--
-- E é INTERSEÇÃO, não "o canto dentro da caixa". Comparar só `xmin`/`ymin`
-- descarta todo polígono cujo canto sudoeste caia fora — medido numa carga da
-- região da Sé: a cobertura de bairro caiu de 100% para 37,7%, porque os
-- bairros vizinhos que entram na área têm o canto do lado de fora dela.
--
-- Os três subtipos juntos porque o Overture não usa um só. Em São Paulo o que
-- existe é o "macrohood" ("Morumbi"); em outras cidades, o "neighborhood".
-- O desempate está na consulta abaixo, do mais específico para o mais geral.
CREATE TEMP TABLE bairros AS
SELECT
  names.primary AS neighborhood,
  CASE subtype
    WHEN 'microhood' THEN 0
    WHEN 'neighborhood' THEN 1
    ELSE 2
  END AS especificidade,
  geometry
FROM read_parquet(
  's3://overturemaps-us-west-2/release/$RELEASE/theme=divisions/type=division_area/*',
  hive_partitioning = 1
)
WHERE bbox.xmin <= $LESTE
  AND bbox.xmax >= $OESTE
  AND bbox.ymin <= $NORTE
  AND bbox.ymax >= $SUL
  AND country = '$PAIS'
  AND subtype IN ('microhood', 'neighborhood', 'macrohood')
  AND names.primary IS NOT NULL;

COPY (
  SELECT
    p.source_id,
    p.name,
    p.category,
    p.latitude,
    p.longitude,
    -- O bairro do polígono mais específico que contém o ponto. Um lugar cai
    -- dentro de vários (o "neighborhood" mora dentro do "macrohood"), e é o
    -- menor deles que diz alguma coisa a quem procura.
    (
      SELECT b.neighborhood
      FROM bairros b
      WHERE ST_Contains(b.geometry, ST_Point(p.longitude, p.latitude))
      ORDER BY b.especificidade
      LIMIT 1
    ) AS neighborhood,
    p.street,
    p.postcode,
    p.locality,
    p.region
  FROM (
  SELECT
    id AS source_id,
    names.primary AS name,
    categories.primary AS category,
    bbox.ymin AS latitude,
    bbox.xmin AS longitude,
    addresses[1].freeform AS street,
    addresses[1].postcode AS postcode,
    addresses[1].locality AS locality,
    addresses[1].region AS region
  FROM read_parquet(
    's3://overturemaps-us-west-2/release/$RELEASE/theme=places/type=place/*',
    hive_partitioning = 1
  )
  WHERE bbox.xmin BETWEEN $OESTE AND $LESTE
    AND bbox.ymin BETWEEN $SUL AND $NORTE
    AND addresses[1].country = '$PAIS'
    AND names.primary IS NOT NULL
    AND (
      categories.primary LIKE '%\_restaurant' ESCAPE '\'
      OR categories.primary IN (
        'restaurant','bar','bakery','cafe','coffee_shop','ice_cream_shop','desserts',
        'smoothie_juice_bar','eat_and_drink','steakhouse','diner','pub','brewery','food',
        'beer_bar','food_truck','cocktail_bar','gastropub','delicatessen','tea_room',
        'milk_bar','tapas_bar','wine_bar','sports_bar','salad_bar','donuts','dive_bar',
        'gay_bar','bubble_tea','food_court','patisserie_cake_shop','bagel_shop','irish_pub',
        'bistro','hotel_bar','cafeteria','pie_shop','whiskey_bar','beach_bar'
      )
    )
  ) p
) TO '$CSV' (FORMAT CSV, HEADER);
SQL

echo "      $(($(wc -l < "$CSV") - 1)) estabelecimentos, $(du -h "$CSV" | cut -f1)"
echo "[2/2] Carregando no banco..."

# `--env-file-if-exists` para a carga local achar o Postgres do `compose.yaml`
# sem ninguém exportar nada. Em produção não atrapalha: variável já definida no
# ambiente vence o arquivo.
node --env-file-if-exists="$RAIZ/.env.development" \
    "$RAIZ/infra/scripts/import-places.mjs" "$CSV"
