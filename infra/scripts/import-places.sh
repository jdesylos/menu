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
duckdb <<SQL
INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';

COPY (
  SELECT
    id AS source_id,
    names.primary AS name,
    categories.primary AS category,
    bbox.ymin AS latitude,
    bbox.xmin AS longitude
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
) TO '$CSV' (FORMAT CSV, HEADER);
SQL

echo "      $(($(wc -l < "$CSV") - 1)) estabelecimentos, $(du -h "$CSV" | cut -f1)"
echo "[2/2] Carregando no banco..."

# `--env-file-if-exists` para a carga local achar o Postgres do `compose.yaml`
# sem ninguém exportar nada. Em produção não atrapalha: variável já definida no
# ambiente vence o arquivo.
node --env-file-if-exists="$RAIZ/.env.development" \
    "$RAIZ/infra/scripts/import-places.mjs" "$CSV"
