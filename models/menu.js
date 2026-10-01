import database from "infra/database.js";
import place from "models/place.js";
import { NotFoundError, ValidationError } from "infra/errors.js";

// O cardápio de um lugar — ver a migration "create-menus" para o porquê das
// três tabelas, e de cada envio ser um cardápio novo.
//
// O aplicativo manda o cardápio JÁ ESTRUTURADO, depois de a pessoa conferir na
// tela de revisão. Aqui não se lê foto nem se extrai nada: confere-se a forma,
// e guarda-se.

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

async function create(user, input) {
  const values = await parseInput(input);

  // Uma instrução só, e por isso atômica: cardápio sem as seções, ou seção sem
  // os pratos, não chega a existir. As seções e os pratos entram como JSON e
  // viram linhas no próprio banco.
  const result = await database.query({
    text: `
      WITH new_menu AS (
        INSERT INTO
          menus (place_id, created_by, currency)
        VALUES
          ($1, $2, $3)
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
      values.placeId,
      user.id,
      values.currency,
      JSON.stringify(values.sections),
      JSON.stringify(values.items),
    ],
  });

  return await findOneById(result.rows[0].id);
}

async function parseInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError({
      message: "O cardápio precisa ser um objeto.",
      action: "Envie place_id, currency e sections.",
    });
  }

  rejectUnknownKeys(input, ["place_id", "currency", "sections"], "no cardápio");

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
        ...parseItem(item),
      });
    });
  });

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

  return { placeId: target.id, currency: input.currency, sections, items };
}

function parseItem(item) {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new ValidationError({
      message: "Um dos pratos não é um objeto.",
      action: "Cada prato leva name, ingredients e price_cents.",
    });
  }

  rejectUnknownKeys(item, ["name", "ingredients", "price_cents"], "no prato");

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

  return { name, ingredients, price_cents: parsePrice(item.price_cents) };
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

  return result.rows[0];
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
          'items', latest.items,
          'created_at', latest.created_at
        ) AS menu
      FROM
        places
        INNER JOIN LATERAL (
          SELECT
            menus.id,
            menus.created_at,
            (
              SELECT
                count(*)::int
              FROM
                menu_items
                INNER JOIN menu_sections ON menu_sections.id = menu_items.section_id
              WHERE
                menu_sections.menu_id = menus.id
            ) AS items
          FROM
            menus
          WHERE
            menus.place_id = places.id
          ORDER BY
            menus.created_at DESC,
            menus.id DESC
          LIMIT
            1
        ) AS latest ON true
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

// O cardápio com as seções e os pratos dentro, na ordem da folha. Montado no
// banco: três idas e a junção aqui seriam o mesmo resultado, mais devagar.
const SELECT_MENU = `
  SELECT
    menus.id,
    menus.place_id,
    menus.created_by,
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
  findLatestByPlaceId,
  findPlaces,
};

export default menu;
