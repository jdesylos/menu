import database from "infra/database.js";
import cdn from "infra/cdn.js";
import place from "models/place.js";
import authorization from "models/authorization.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "infra/errors.js";

// O cardápio de um lugar — ver a migration "create-menus" para o porquê das
// três tabelas, e de cada envio ser um cardápio novo.
//
// O aplicativo manda o cardápio JÁ ESTRUTURADO, depois de a pessoa conferir na
// tela de revisão. Aqui não se lê foto nem se extrai nada: confere-se a forma,
// e guarda-se.
//
// # Trocar o cardápio que vale
//
// O que vale para o lugar é o mais recente. O primeiro cardápio de um lugar
// entra sem pedir mais nada. Para trocar o que já existe, o pedido diz qual
// ele substitui (`replaces`), e a troca é recusada (409) quando aquele não é
// mais o que vale: alguém trocou antes.
//
// Quem troca, e o quê:
//
// - **Fotografando no lugar** (`position`, a até 100 m dele): qualquer conta,
//   e qualquer mudança. É quem está vendo a folha.
// - **Sem fotografar**: só quem mandou o cardápio que vale, e só o TEXTO dos
//   pratos que já estão nele — todos voltam, pelo `id`, e nenhum entra.
//
// Sem essa separação, qualquer conta trocava o preço de qualquer lugar do mapa
// com um POST, e ninguém revisa o que chega. Era o motivo da trava que havia
// antes, de um cardápio só por lugar.
//
// # O limite
//
// A posição vem do aparelho, e um GPS falso passa. O raio segura quem troca,
// de casa, o cardápio de um lugar onde nunca esteve, e não quem insiste. Contra
// esse, cada troca fica guardada com o cardápio que substituiu e a distância
// (`replaces_menu_id` e `distance_m`), e dá para voltar atrás.
//
// E duas contas mandando o primeiro cardápio do mesmo lugar no mesmo instante
// passam as duas, como passam duas trocas do mesmo cardápio: a conferência e a
// gravação são uma instrução só, mas cada uma vê o banco de quando começou.

const CURRENCIES = ["BRL", "USD", "EUR"];

// Os tetos. Nenhum deles é de cardápio de verdade — o maior já visto tem umas
// dez seções e cem pratos —, e sim de pedido torto: um campo de texto sem teto
// é convite a guardar qualquer coisa no banco.
const MAX_SECTIONS = 100;
const MAX_ITEMS = 1000;
const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_INGREDIENTS_LENGTH = 1000;
// R$ 999.999,99. Acima disso é vírgula no lugar errado, e não prato.
const MAX_PRICE_CENTS = 99_999_999;

// O raio de quem fotografa: até 100 m do ponto do lugar, descontado o erro do
// GPS a favor de quem está lá. Dentro de um prédio ele erra dezenas de metros,
// e o ponto de um lugar num shopping pode ser o centro do shopping.
const REACH_M = 100;
// A leitura de GPS mais imprecisa que ainda conta. A localização "aproximada"
// do Android chega a 2 km de erro, e com ela qualquer um estaria no raio de
// qualquer lugar.
const MAX_ACCURACY_M = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function create(user, input) {
  const values = await parseInput(input);

  if (values.replaces) {
    return await replace(user, values);
  }

  const id = await insert(user, values, { replaces: null, distance: null });

  if (id === null) {
    throw new ValidationError({
      message: "Este lugar já tem cardápio.",
      action: "Abra o cardápio dele pelo mapa.",
    });
  }

  // O tile do lugar diz se ele tem cardápio (`has_menu`), e a borda o guarda
  // por uma hora: sem isto, o marcador de quem acabou de ganhar um cardápio
  // seguia sem cor no mapa — com o lugar já na lista de cardápios, que não
  // passa pela borda.
  //
  // Só no primeiro cardápio do lugar, que é o único que muda o `has_menu`: a
  // troca não muda a cor do marcador.
  cdn.forget(place.cacheTagsOf(values.place));

  return await findOneById(id);
}

// A troca do cardápio que vale — ver o topo do arquivo para quem troca e o
// quê.
async function replace(user, values) {
  const base = await findOneById(values.replaces);

  if (!base || base.place_id !== values.place.id) {
    throw new NotFoundError({
      message: "O cardápio a substituir não é deste lugar.",
      action: "Abra o cardápio do lugar de novo e refaça as mudanças.",
    });
  }

  rejectItemsNotIn(base, values.items);

  let distance = null;
  if (values.position) {
    distance = distanceInMeters(values.place, values.position);
    rejectOutOfReach(values.position, distance);
  } else {
    rejectMoreThanText(user, base, values.items);
  }

  const id = await insert(user, values, {
    replaces: base.id,
    distance: distance === null ? null : Math.round(distance),
  });

  if (id === null) {
    throw new ConflictError({
      message: "O cardápio deste lugar mudou enquanto você o editava.",
      action: "Abra o cardápio de novo e refaça as mudanças.",
    });
  }

  return await findOneById(id);
}

// Grava o cardápio, e devolve o id dele — ou `null`, quando o lugar não está
// como o pedido supunha: sem cardápio nenhum, no primeiro; com `replaces`
// ainda valendo, na troca.
//
// Uma instrução só, e por isso atômica: cardápio sem as seções, ou seção sem
// os pratos, não chega a existir. As seções e os pratos entram como JSON e
// viram linhas no próprio banco.
async function insert(user, values, { replaces, distance }) {
  const result = await database.query({
    text: `
      WITH new_menu AS (
        INSERT INTO
          menus (place_id, created_by, currency, replaces_menu_id, distance_m)
        SELECT
          $1, $2, $3, $6::uuid, $7::integer
        WHERE
          CASE
            WHEN $6::uuid IS NULL THEN NOT EXISTS (
              SELECT
                1
              FROM
                menus
              WHERE
                menus.place_id = $1
            )
            ELSE $6::uuid = (
              SELECT
                menus.id
              FROM
                menus
              WHERE
                menus.place_id = $1
              ORDER BY
                menus.created_at DESC,
                menus.id DESC
              LIMIT
                1
            )
          END
        RETURNING
          id
      ),
      new_sections AS (
        INSERT INTO
          menu_sections (menu_id, position, title)
        SELECT
          new_menu.id,
          section.position,
          section.title
        FROM
          new_menu,
          jsonb_to_recordset($4::jsonb) AS section (position integer, title text)
        RETURNING
          id,
          position
      ),
      new_items AS (
        INSERT INTO
          menu_items (section_id, position, name, ingredients, price_cents)
        SELECT
          new_sections.id,
          item.position,
          item.name,
          item.ingredients,
          item.price_cents
        FROM
          jsonb_to_recordset($5::jsonb) AS item (
            section_position integer,
            position integer,
            name text,
            ingredients text,
            price_cents bigint
          )
          INNER JOIN new_sections ON new_sections.position = item.section_position
        RETURNING
          id
      )
      SELECT
        id
      FROM
        new_menu
    ;`,
    values: [
      values.place.id,
      user.id,
      values.currency,
      JSON.stringify(values.sections),
      JSON.stringify(values.items),
      replaces,
      distance,
    ],
  });

  return result.rowCount === 0 ? null : result.rows[0].id;
}

// Um prato com `id` é um prato do cardápio substituído, que volta com outro
// texto. Um `id` que não é dele é pedido torto, e não permissão a conferir.
function rejectItemsNotIn(base, items) {
  const known = new Set(itemIdsOf(base));

  if (items.some((item) => item.id !== undefined && !known.has(item.id))) {
    throw new ValidationError({
      message: "Um dos pratos não é do cardápio que está sendo substituído.",
      action: "Abra o cardápio do lugar de novo e refaça as mudanças.",
    });
  }
}

// Sem fotografar: só quem mandou, e só o texto — todos os pratos de antes
// voltam, e nenhum entra. Os `id` já são únicos (`parseInput`) e todos do
// cardápio substituído (`rejectItemsNotIn`), então contar basta.
function rejectMoreThanText(user, base, items) {
  if (!canEditText(user, base)) {
    throw new ForbiddenError({
      message: "Só quem mandou este cardápio pode mudar o texto dele.",
      action: "Para trocar o cardápio, fotografe-o no lugar.",
    });
  }

  const sameItems =
    items.every((item) => item.id !== undefined) &&
    items.length === itemIdsOf(base).length;

  if (!sameItems) {
    throw new ForbiddenError({
      message:
        "Sem fotografar, só se muda o texto dos pratos que já estão no cardápio.",
      action:
        "Para tirar ou acrescentar pratos, fotografe o cardápio no lugar.",
    });
  }
}

function rejectOutOfReach(position, distance) {
  if (position.accuracy_m > MAX_ACCURACY_M) {
    throw new ForbiddenError({
      message: "A localização do aparelho não está precisa o bastante.",
      action: "Ligue a localização exata e fotografe de novo.",
    });
  }

  if (distance - position.accuracy_m > REACH_M) {
    throw new ForbiddenError({
      message: `Você está a ${formatDistance(distance)} deste lugar.`,
      action: `Para trocar o cardápio de um lugar, fotografe-o a até ${REACH_M} m dele.`,
    });
  }
}

function itemIdsOf(found) {
  return found.sections.flatMap((section) =>
    section.items.map((item) => item.id),
  );
}

// A distância na superfície da Terra, pela fórmula de haversine. A conta da
// busca (`place.search`), em graus e sem raiz, serve para ordenar; aqui o
// número é comparado com metros.
function distanceInMeters(from, to) {
  const EARTH_RADIUS_M = 6_371_000;
  const radians = (degrees) => (Number(degrees) * Math.PI) / 180;

  const dLat = radians(to.latitude) - radians(from.latitude);
  const dLon = radians(to.longitude) - radians(from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// "850 m", "2,1 km" — como a lista do aplicativo diz.
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

async function parseInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError({
      message: "O cardápio precisa ser um objeto.",
      action: "Envie place_id, currency e sections.",
    });
  }

  rejectUnknownKeys(
    input,
    ["place_id", "currency", "sections", "replaces", "position"],
    "no cardápio",
  );

  const replaces = parseReplaces(input.replaces);

  if (input.position !== undefined && replaces === null) {
    throw new ValidationError({
      message: "A posição só vale para trocar um cardápio.",
      action: "Envie position junto de replaces, ou tire-a.",
    });
  }
  const position =
    input.position === undefined ? null : parsePosition(input.position);

  if (!CURRENCIES.includes(input.currency)) {
    throw new ValidationError({
      message: `A moeda "${input.currency}" não é aceita.`,
      action: `Use uma destas: ${CURRENCIES.join(", ")}.`,
    });
  }

  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    throw new ValidationError({
      message: "O cardápio não tem nenhuma seção.",
      action: 'Envie em "sections" pelo menos uma seção com pratos.',
    });
  }

  if (input.sections.length > MAX_SECTIONS) {
    throw new ValidationError({
      message: `O cardápio tem mais de ${MAX_SECTIONS} seções.`,
      action: "Envie o cardápio em partes menores.",
    });
  }

  const sections = [];
  const items = [];

  input.sections.forEach((section, sectionPosition) => {
    if (typeof section !== "object" || section === null) {
      throw new ValidationError({
        message: "Uma das seções não é um objeto.",
        action: "Cada seção leva title e items.",
      });
    }

    rejectUnknownKeys(section, ["title", "items"], "na seção");

    sections.push({
      position: sectionPosition,
      title: parseText(section.title ?? "", {
        field: "o título da seção",
        max: MAX_TITLE_LENGTH,
      }),
    });

    if (!Array.isArray(section.items)) {
      throw new ValidationError({
        message: 'Uma das seções não tem a lista "items".',
        action: "Cada seção leva title e items.",
      });
    }

    section.items.forEach((item, itemPosition) => {
      items.push({
        section_position: sectionPosition,
        position: itemPosition,
        ...parseItem(item, { replacing: replaces !== null }),
      });
    });
  });

  const ids = items.filter((item) => item.id !== undefined).map((i) => i.id);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError({
      message: "Dois pratos vieram com o mesmo id.",
      action: "Cada prato do cardápio substituído volta uma vez só.",
    });
  }

  if (items.length === 0) {
    throw new ValidationError({
      message: "O cardápio não tem nenhum prato.",
      action: "Envie pelo menos um prato em alguma seção.",
    });
  }

  if (items.length > MAX_ITEMS) {
    throw new ValidationError({
      message: `O cardápio tem mais de ${MAX_ITEMS} pratos.`,
      action: "Envie o cardápio em partes menores.",
    });
  }

  // Por último, porque é a única conferência que vai ao banco: pedido torto
  // volta 400 sem gastar a consulta.
  const target = await findVisiblePlace(input.place_id);

  return {
    place: target,
    currency: input.currency,
    sections,
    items,
    replaces,
    position,
  };
}

// O cardápio que a troca substitui. Id sem forma de UUID não existe, e
// passá-lo ao Postgres viraria erro de sintaxe — um 500 no lugar do 400.
function parseReplaces(value) {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError({
      message: "O cardápio a substituir precisa ser um id.",
      action: "Envie em replaces o id do cardápio que vale para o lugar.",
    });
  }

  return value;
}

// Onde estava quem fotografou, como o aparelho mediu: a coordenada e o raio do
// erro, em metros.
function parsePosition(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError({
      message: "A posição precisa ser um objeto.",
      action: "Envie latitude, longitude e accuracy_m.",
    });
  }

  rejectUnknownKeys(
    value,
    ["latitude", "longitude", "accuracy_m"],
    "na posição",
  );

  const { latitude, longitude, accuracy_m } = value;
  const valid =
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    Number.isFinite(accuracy_m) &&
    accuracy_m >= 0;

  if (!valid) {
    throw new ValidationError({
      message: "A posição não é uma coordenada.",
      action:
        "Envie latitude e longitude em graus, e accuracy_m em metros, como números.",
    });
  }

  return { latitude, longitude, accuracy_m };
}

function parseItem(item, { replacing }) {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new ValidationError({
      message: "Um dos pratos não é um objeto.",
      action: "Cada prato leva name, ingredients e price_cents.",
    });
  }

  // O `id` diz qual prato do cardápio substituído este é, e só vale na troca.
  const known = replacing
    ? ["id", "name", "ingredients", "price_cents"]
    : ["name", "ingredients", "price_cents"];
  rejectUnknownKeys(item, known, "no prato");

  if (
    item.id !== undefined &&
    (typeof item.id !== "string" || !UUID_PATTERN.test(item.id))
  ) {
    throw new ValidationError({
      message: "O id de um dos pratos não é um id.",
      action: "Envie o id que o prato tinha no cardápio lido, ou nenhum.",
    });
  }

  const name = parseText(item.name, {
    field: "o nome do prato",
    max: MAX_NAME_LENGTH,
  });
  if (name === "") {
    throw new ValidationError({
      message: "Um dos pratos está sem nome.",
      action: "O nome é a única coisa que todo prato precisa ter.",
    });
  }

  // Texto vazio é "não tem", e não um texto: guardar "" faria a tela mostrar
  // uma linha de ingredientes em branco.
  const ingredients =
    parseText(item.ingredients ?? "", {
      field: "os ingredientes do prato",
      max: MAX_INGREDIENTS_LENGTH,
    }) || null;

  return {
    id: item.id,
    name,
    ingredients,
    price_cents: parsePrice(item.price_cents),
  };
}

// Aparado e em NFC: acento decomposto renderiza com "?" no atlas do
// aplicativo, e "Pão" escrito de dois jeitos seriam dois pratos na busca.
function parseText(value, { field, max }) {
  if (typeof value !== "string") {
    throw new ValidationError({
      message: `Era esperado um texto para ${field}.`,
      action: "Envie o campo como texto.",
    });
  }

  const text = value.normalize("NFC").trim();

  if (text.length > max) {
    throw new ValidationError({
      message: `O texto de ${field} passa de ${max} caracteres.`,
      action: "Encurte o texto e envie de novo.",
    });
  }

  return text;
}

// Centavos inteiros, ou nada. Número quebrado é o preço em reais mandado no
// lugar dos centavos, e arredondar esconderia o engano.
function parsePrice(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
    throw new ValidationError({
      message: `O preço "${value}" não é um valor em centavos.`,
      action: `Envie price_cents como inteiro entre 0 e ${MAX_PRICE_CENTS}, ou deixe sem preço.`,
    });
  }

  return value;
}

// Campo desconhecido volta 400 em vez de ser descartado em silêncio, que diria
// "ok" a um pedido que não foi atendido.
function rejectUnknownKeys(object, known, where) {
  const unknown = Object.keys(object).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError({
      message: `Campo desconhecido ${where}: ${unknown.join(", ")}.`,
      action: `Use só estes: ${known.join(", ")}.`,
    });
  }
}

async function findVisiblePlace(id) {
  const found = await place.findOneById(id);

  if (found.hidden_at !== null) {
    throw new NotFoundError({
      message: "O lugar informado não está mais no mapa.",
      action: "Atualize o mapa e tente de novo.",
    });
  }

  return found;
}

// O cardápio que vale para o lugar: o mais recente.
async function findLatestByPlaceId(placeId) {
  const target = await findVisiblePlace(placeId);

  const result = await database.query({
    text: `
      ${SELECT_MENU}
      WHERE
        menus.place_id = $1
      ORDER BY
        menus.created_at DESC,
        menus.id DESC
      LIMIT
        1
    ;`,
    values: [target.id],
  });

  if (result.rowCount === 0) {
    throw new NotFoundError({
      message: "Este lugar ainda não tem cardápio.",
      action: "Fotografe o cardápio para ser a primeira pessoa a enviar.",
    });
  }

  // Onde fica o lugar: é dali que o aplicativo mede o raio de quem quer
  // fotografar o cardápio de novo — ver `create`.
  return {
    ...result.rows[0],
    place_location: { latitude: target.latitude, longitude: target.longitude },
  };
}

// Se `user` pode mudar o TEXTO de `found` — nome, descrição, preço, título —
// de onde estiver, sem fotografar: só quem mandou aquele cardápio. Quem não o
// mandou só o troca fotografando de novo, no lugar — ver `create`.
//
// É o que o aplicativo pergunta para mostrar o botão de editar, e o que
// `create` confere quando o pedido chega sem posição.
function canEditText(user, found) {
  return (
    typeof user.id === "string" &&
    user.id === found.created_by &&
    authorization.can(user, "create:menu")
  );
}

async function findOneById(id) {
  const result = await database.query({
    text: `
      ${SELECT_MENU}
      WHERE
        menus.id = $1
      LIMIT
        1
    ;`,
    values: [id],
  });

  return result.rows[0];
}

// Uma linha da lista de lugares com cardápio: o que o mapa já diz do lugar,
// mais o resumo de um cardápio dele — quantos pratos e de quando é. Quem
// escolhe QUAL cardápio é a consulta, numa subconsulta chamada `latest`.
//
// A contagem de pratos fica aqui, fora da subconsulta: assim ela roda só para
// o cardápio escolhido, e não para cada um que o lugar já recebeu.
const SELECT_PLACE_WITH_MENU = `
  SELECT
    places.id,
    places.name,
    places.category,
    places.latitude,
    places.longitude,
    places.street,
    places.neighborhood,
    places.locality,
    places.region,
    places.postcode,
    jsonb_build_object(
      'id', latest.id,
      'items', (
        SELECT
          count(*)::int
        FROM
          menu_items
          INNER JOIN menu_sections ON menu_sections.id = menu_items.section_id
        WHERE
          menu_sections.menu_id = latest.id
      ),
      'created_at', latest.created_at
    ) AS menu
`;

// Quantos lugares a listagem devolve. Não é paginada ainda: são os mais
// próximos de quem pergunta, e quem quer um lugar longe o acha pela busca.
const MAX_PLACES = 50;

// Os lugares que têm cardápio, os mais perto primeiro — o que o botão
// "Cardápios" do aplicativo abre.
//
// De cada lugar, o que o mapa já diz dele, mais o resumo do cardápio que
// vale: quantos pratos e de quando é. O cardápio inteiro não vem: a lista
// pode ter cinquenta lugares, e quem toca num deles busca o dele.
//
// A distância é a mesma conta da busca — ver `place.search` —, em graus e sem
// raiz: só precisa ordenar. Sem origem, os mais recentes primeiro.
//
// A consulta parte de `menus`, e não de `places`. Partindo de `places`, o
// banco procurava cardápio em CADA lugar do país — centenas de milhares de
// linhas — para devolver os dois que tinham um: medido em produção, mais de um
// segundo com o banco quente e 18,7 s com ele frio, mais que os 15 s que o
// aplicativo espera. O `DISTINCT ON` fica com o cardápio mais recente de cada
// lugar, pelo índice de `(place_id, created_at DESC)`, e o custo passa a ser
// o número de cardápios.
async function findPlaces({ latitude, longitude }) {
  const hasOrigin = latitude !== null && longitude !== null;

  const values = hasOrigin ? [latitude, longitude, MAX_PLACES] : [MAX_PLACES];

  const ordering = [];
  if (hasOrigin) {
    ordering.push(`(places.latitude - $1) * (places.latitude - $1)
        + (places.longitude - $2) * (places.longitude - $2)
        * power(cos(radians($1)), 2)`);
  }
  ordering.push("latest.created_at DESC", "places.id");

  const result = await database.query({
    text: `
      ${SELECT_PLACE_WITH_MENU}
      FROM
        (
          SELECT DISTINCT ON (menus.place_id)
            menus.id,
            menus.place_id,
            menus.created_at
          FROM
            menus
          ORDER BY
            menus.place_id,
            menus.created_at DESC,
            menus.id DESC
        ) AS latest
        INNER JOIN places ON places.id = latest.place_id
      WHERE
        places.hidden_at IS NULL
      ORDER BY
        ${ordering.join(",\n        ")}
      LIMIT
        $${values.length}
    ;`,
    values,
  });

  return result.rows;
}

// Os lugares para onde `userId` mandou cardápio, do envio mais recente para o
// mais antigo — a aba "Meus cardápios" do aplicativo.
//
// O resumo de cada lugar é o do último cardápio que ESTA conta mandou para
// ele, e não o do que vale: se outra pessoa o trocou depois — fotografando no
// lugar, ver `create` —, a linha continua dizendo o que a conta mandou.
//
// O lugar oculto fica de fora, como na lista de todos: o cardápio dele
// continua guardado, mas não há mais o lugar no mapa para abri-lo.
//
// A conta apagada não chega aqui — sem sessão, não há quem pergunte —, e os
// cardápios dela continuam valendo para os lugares, na lista de todos.
//
// Parte de `menus` pelo índice de `created_by`: o custo é o número de
// cardápios que a conta mandou.
async function findPlacesByCreator(userId) {
  const result = await database.query({
    text: `
      ${SELECT_PLACE_WITH_MENU}
      FROM
        (
          SELECT DISTINCT ON (menus.place_id)
            menus.id,
            menus.place_id,
            menus.created_at
          FROM
            menus
          WHERE
            menus.created_by = $1
          ORDER BY
            menus.place_id,
            menus.created_at DESC,
            menus.id DESC
        ) AS latest
        INNER JOIN places ON places.id = latest.place_id
      WHERE
        places.hidden_at IS NULL
      ORDER BY
        latest.created_at DESC,
        places.id
      LIMIT
        $2
    ;`,
    values: [userId, MAX_PLACES],
  });

  return result.rows;
}

// O cardápio com as seções e os pratos dentro, na ordem da folha. Montado no
// banco: três idas e a junção aqui seriam o mesmo resultado, mais devagar.
const SELECT_MENU = `
  SELECT
    menus.id,
    menus.place_id,
    menus.created_by,
    menus.replaces_menu_id,
    menus.currency,
    menus.created_at,
    COALESCE(
      (
        SELECT
          jsonb_agg(
            jsonb_build_object(
              'title', menu_sections.title,
              'items', COALESCE(
                (
                  SELECT
                    jsonb_agg(
                      jsonb_build_object(
                        'id', menu_items.id,
                        'name', menu_items.name,
                        'ingredients', menu_items.ingredients,
                        'price_cents', menu_items.price_cents
                      )
                      ORDER BY menu_items.position
                    )
                  FROM
                    menu_items
                  WHERE
                    menu_items.section_id = menu_sections.id
                ),
                '[]'::jsonb
              )
            )
            ORDER BY menu_sections.position
          )
        FROM
          menu_sections
        WHERE
          menu_sections.menu_id = menus.id
      ),
      '[]'::jsonb
    ) AS sections
  FROM
    menus
`;

const menu = {
  create,
  canEditText,
  findLatestByPlaceId,
  findPlaces,
  findPlacesByCreator,
};

export default menu;
