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
#
# Nem sempre é uma linha só: o 2026-09-23.0 trocou a coluna de categoria, e a
# consulta abaixo mudou junto. Um release anterior a ele não roda mais com este
# script — ver o comentário das categorias.
RELEASE="${OVERTURE_RELEASE:-2026-09-23.0}"

# O release do Foursquare OS Places, fixo pelo mesmo motivo.
#
# É a segunda fonte, e entra só para uma coisa: dizer quem FECHOU. O Overture
# não sabe — o "operating_status" dele veio vazio em 100% dos lugares de comer
# de São Paulo no release acima, e 93% dos registros vêm de páginas do
# Facebook, que continuam no ar anos depois de o restaurante fechar. O
# Foursquare publica "date_closed" por lugar, sob Apache 2.0.
#
# Ele fica no Hugging Face, com acesso liberado mediante aceite dos termos, e a
# leitura exige um token de leitura de quem roda a carga: HF_TOKEN. Sem ele a
# carga segue só com o Overture, como era antes, e avisa.
FSQ_RELEASE="${FSQ_RELEASE:-2026-09-15}"

# A carga cobre o país inteiro quando ninguém recortou a caixa nem trocou o
# país. Só aí "não veio no CSV" quer dizer "sumiu do Overture", e o
# import-places.mjs pode tirar do mapa o que sumiu — ver o comentário dele.
if [ -z "${OESTE:-}${SUL:-}${LESTE:-}${NORTE:-}${PAIS:-}" ]; then
    PAIS_INTEIRO="--pais-inteiro"
else
    PAIS_INTEIRO=""
fi

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

# Crase dentro do heredoc SQL vira execução de comando, porque o heredoc não é
# citado (ver o comentário logo acima do `duckdb <<SQL`). Lá já existe o aviso
# escrito, e ele foi violado duas vezes — então aqui está o mesmo aviso como
# verificação: um `xmin` entre crases num comentário SQL imprimia
# "xmin: command not found" e desaparecia da consulta.
#
# Roda ANTES do S3 de propósito: o erro aparece na hora, não depois de minutos
# baixando parquet. E lê o PRÓPRIO arquivo, que é o único jeito de vigiar um
# heredoc embutido.
#
# Vigia também o SQL do Foursquare, que mora numa string entre aspas duplas
# (FECHADOS_SQL) antes de ser colado no heredoc: ali a crase executa do mesmo
# jeito, e um pouco antes.
if awk '/^SQL$/ || /^"$/ { dentro = 0 }
        dentro && /`/ { achou = 1 }
        /^duckdb <<SQL$/ || /^    FECHADOS_SQL="$/ { dentro = 1 }
        END { exit !achou }' "${BASH_SOURCE[0]}"; then
    echo "erro: crase dentro do SQL — use aspas nos comentários" >&2
    awk '/^SQL$/ || /^"$/ { dentro = 0 }
         dentro && /`/ { printf "  linha %d: %s\n", NR, $0 }
         /^duckdb <<SQL$/ || /^    FECHADOS_SQL="$/ { dentro = 1 }' "${BASH_SOURCE[0]}" >&2
    exit 1
fi

CSV="$(mktemp -t places).csv"
FECHADOS="$(mktemp -t fechados).csv"
trap 'rm -f "$CSV" "$FECHADOS"' EXIT

# Quem fechou, segundo o Foursquare — ou ninguém, sem o token.
#
# A regra, e por que ela é assim:
#
# - Um lugar do Overture é o MESMO do Foursquare quando os dois estão a menos de
#   120 m e o nome normalizado (minúsculo, sem acento, só letras e números) é
#   igual, ou um contém o outro. As duas fontes escrevem o mesmo lugar de jeitos
#   diferentes: "Old Dog Dogueria" e "Old Dog", "Mezzo Steakhouse e Café" e
#   "Mezzo Steakhouse".
# - Ele SAI só quando algum par é fechado e NENHUM par é aberto. Na dúvida, o
#   lugar fica: esconder um restaurante que existe é pior do que mostrar um que
#   fechou.
# - O par fechado precisa ser forte: nome igual, ou nome contido com pelo menos
#   seis letras no menor, e o menor não pode ser uma palavra genérica. Medido no
#   Brasil inteiro: sem essa trava, "Restaurante a Quilo ... Salsalito" casava
#   com um lugar chamado só "Almoço". Casamento aproximado (Jaro-Winkler) foi
#   descartado: juntou "Restaurante Porque Sim" com "Restaurante Fuji".
#
# Medido nos releases fixados acima: 605.021 lugares de comer no Brasil, 32%
# com par no Foursquare, 10.490 fechados (1,7%). A nota de confiança do
# Overture de quem sai tem média 0,46, contra 0,66 do resto. Na Liberdade, os
# cinco que a regra tira foram conferidos em fontes independentes: nenhum
# estava aberto com aquele nome e endereço.
#
# O limite: 68% dos lugares não têm par no Foursquare, e sobre eles esta regra
# não diz nada.
if [ -n "${HF_TOKEN:-}" ]; then
    FECHADOS_SQL="
CREATE SECRET hf (TYPE huggingface, TOKEN '$HF_TOKEN');

CREATE TEMP TABLE fsq AS
SELECT
  name,
  latitude,
  longitude,
  date_closed IS NOT NULL AS fechado
FROM read_parquet(
  'hf://datasets/foursquare/fsq-os-places/release/dt=$FSQ_RELEASE/places/parquet/*.parquet'
)
WHERE bbox.xmin BETWEEN $OESTE AND $LESTE
  AND bbox.ymin BETWEEN $SUL AND $NORTE
  AND country = '$PAIS'
  AND name IS NOT NULL
  AND list_has_any(
    list_transform(fsq_category_labels, lambda c: split_part(c, ' > ', 1)),
    ['Dining and Drinking']
  );

CREATE MACRO normalizado(s) AS regexp_replace(lower(strip_accents(s)), '[^a-z0-9]', '', 'g');

-- Palavras que, sozinhas, não identificam lugar nenhum.
CREATE TEMP TABLE genericos AS SELECT unnest([
  'almoco','restaurante','restaurant','lanchonete','lanches','pizzaria','pizza',
  'padaria','churrascaria','pastelaria','pastel','sorveteria','cafeteria',
  'confeitaria','doceria','hamburgueria','burger','sushi','temakeria','espetinho',
  'cervejaria','choperia','petiscaria','boteco','botequim','quiosque','delivery',
  'marmitex','marmitaria','selfservice','rodizio','comida','cantina','bistro',
  'acai','bomboniere','refeicoes','coffee','food','foodtruck'
]) AS palavra;

-- A vizinhança por grade: cada lugar do Foursquare entra nas nove células de
-- 0,002 grau em volta da sua, e o par se procura por igualdade de célula. É o
-- que deixa o país inteiro cruzar em segundos em vez de comparar tudo com tudo.
CREATE TEMP TABLE pares AS
WITH o AS (
  SELECT
    source_id, latitude, longitude, normalizado(name) AS n,
    floor(latitude / 0.002)::BIGINT AS cy, floor(longitude / 0.002)::BIGINT AS cx
  FROM lugares
),
f AS (
  SELECT
    latitude, longitude, fechado, normalizado(name) AS n,
    floor(latitude / 0.002)::BIGINT + dy AS cy, floor(longitude / 0.002)::BIGINT + dx AS cx
  FROM fsq, (SELECT unnest([-1, 0, 1]) AS dy), (SELECT unnest([-1, 0, 1]) AS dx)
)
SELECT
  o.source_id,
  f.fechado,
  o.n = f.n
    OR (
      least(length(o.n), length(f.n)) >= 6
      AND (CASE WHEN length(o.n) < length(f.n) THEN o.n ELSE f.n END)
        NOT IN (SELECT palavra FROM genericos)
    ) AS forte
FROM o JOIN f ON o.cy = f.cy AND o.cx = f.cx
WHERE length(o.n) > 0 AND length(f.n) > 0
  AND 6371000 * 2 * asin(sqrt(
        pow(sin(radians(f.latitude - o.latitude) / 2), 2)
        + cos(radians(o.latitude)) * cos(radians(f.latitude))
          * pow(sin(radians(f.longitude - o.longitude) / 2), 2)
      )) < 120
  AND (
    o.n = f.n
    OR (contains(o.n, f.n) AND length(f.n) >= 4)
    OR (contains(f.n, o.n) AND length(o.n) >= 4)
  );

CREATE TEMP TABLE fechados AS
SELECT source_id
FROM pares
GROUP BY source_id
HAVING bool_or(fechado AND forte) AND NOT bool_or(NOT fechado);
"
else
    echo "aviso: sem HF_TOKEN — a carga segue só com o Overture, e quem fechou" >&2
    echo "       continua no mapa. Ver o comentário de FSQ_RELEASE neste script." >&2
    FECHADOS_SQL="CREATE TEMP TABLE fechados (source_id VARCHAR);"
fi

echo "[1/2] Extraindo do Overture (release $RELEASE) e do Foursquare (release $FSQ_RELEASE)..."

# O que conta como "onde se come": a raiz `food_and_drink` da taxonomia do
# Overture, menos três ramos.
#
# Até o release 2026-08-19.0 o Overture publicava `categories`, uma lista plana
# de 1508 categorias no Brasil, e a regra era uma lista EXPLÍCITA delas —
# procurar "bar" dentro do nome trazia `barber`, 70 mil barbearias. O
# 2026-09-23.0 trocou essa coluna por `taxonomy`, uma árvore, e a lista virou a
# raiz dela.
#
# Medido na cidade de São Paulo, cruzando os dois releases pelo id: dos lugares
# que a lista antiga trazia, 98,5% estão sob `food_and_drink`. O resto saiu
# porque o Overture o reclassificou pelo que é — o `food` genérico virou
# mercearia, parte dos bufês virou serviço de festa. As exclusões que a lista
# antiga fazia de propósito caíram fora da raiz sozinhas, mais de 95% de cada
# uma: `health_food_store` e `specialty_foods` (são loja),
# `food_delivery_service` (não tem salão para visitar) e
# `food_beverage_service_distribution` (é atacado).
#
# Os três ramos cortados:
#
# - `candy_store`, com `chocolatier` embaixo: doceria e chocolateria são loja,
#   e o ícone do mapa é garfo e faca. Na lista antiga também ficavam de fora;
# - `internet_cafe`: é lan house;
# - `airport_lounge`: é sala VIP de companhia aérea.
#
# O que a árvore traz a mais, e fica: narguilé, lounge, adega, cervejaria ao ar
# livre, sanduicheria, gelateria, panquecaria, kebab. São lugares onde se come
# ou se bebe que a lista antiga não nomeava — não exclusões pensadas.
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
-- E é INTERSEÇÃO, não "o canto dentro da caixa". Comparar só "xmin"/"ymin"
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

CREATE TEMP TABLE lugares AS
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
    taxonomy.primary AS category,
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
    AND taxonomy.hierarchy[1] = 'food_and_drink'
    AND NOT list_has_any(
      taxonomy.hierarchy, ['candy_store', 'internet_cafe', 'airport_lounge']
    )
  ) p;

$FECHADOS_SQL

-- O que fechou não entra no CSV, e o import-places.mjs o oculta se já estava
-- no banco: o upsert sozinho só acrescenta e atualiza.
COPY (
  SELECT * FROM lugares WHERE source_id NOT IN (SELECT source_id FROM fechados)
) TO '$CSV' (FORMAT CSV, HEADER);

COPY (SELECT source_id FROM fechados) TO '$FECHADOS' (FORMAT CSV, HEADER);
SQL

echo "      $(($(wc -l < "$CSV") - 1)) estabelecimentos, $(du -h "$CSV" | cut -f1)"
echo "      $(($(wc -l < "$FECHADOS") - 1)) fechados, segundo o Foursquare"
echo "[2/2] Carregando no banco..."

# `--env-file-if-exists` para a carga local achar o Postgres do `compose.yaml`
# sem ninguém exportar nada. Em produção não atrapalha: variável já definida no
# ambiente vence o arquivo.
#
# $PAIS_INTEIRO fica sem aspas de propósito: vazio, ele some da linha em vez de
# virar um argumento vazio.
# shellcheck disable=SC2086
node --env-file-if-exists="$RAIZ/.env.development" \
    "$RAIZ/infra/scripts/import-places.mjs" "$CSV" \
    --fechados="$FECHADOS" $PAIS_INTEIRO

# Os lugares acrescentados à mão, que nenhuma fonte tem — ver
# `import-manual-places.mjs`. A carga do Overture não os toca, porque tudo nela
# filtra por `source`; rodar aqui é o que garante que a lista versionada e o
# banco não se afastem sem ninguém notar.
node --env-file-if-exists="$RAIZ/.env.development" \
    "$RAIZ/infra/scripts/import-manual-places.mjs"
