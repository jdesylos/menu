import database from "infra/database.js";
import menu from "models/menu.js";
import place from "models/place.js";

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function findPlaceMenus(placeId) {
  const target = await place.findOneById(placeId);

  const [latestResult, historyResult] = await Promise.all([
    database.query({
      text: `
        ${menu.SELECT_MENU}
        WHERE
          menus.place_id = $1
        ORDER BY
          menus.created_at DESC,
          menus.id DESC
        LIMIT 1
      ;`,
      values: [target.id],
    }),
    database.query({
      text: `
        SELECT
          menus.id,
          menus.currency,
          menus.replaces_menu_id,
          menus.distance_m,
          menus.created_at,
          menus.created_by,
          users.username AS author_username,
          (
            SELECT count(*)::int
            FROM menu_items
            INNER JOIN menu_sections ON menu_sections.id = menu_items.section_id
            WHERE menu_sections.menu_id = menus.id
          ) AS items_count
        FROM
          menus
          LEFT JOIN users ON users.id = menus.created_by
        WHERE
          menus.place_id = $1
        ORDER BY
          menus.created_at DESC,
          menus.id DESC
        LIMIT 30
      ;`,
      values: [target.id],
    }),
  ]);

  return {
    place: target,
    latest_menu: latestResult.rows[0] ?? null,
    history: historyResult.rows,
  };
}

async function listWithMenus(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const rawPage = Number.parseInt(query.page ?? "1", 10);
  const rawLimit = Number.parseInt(query.limit ?? "25", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 50)
    : 25;
  const offset = (page - 1) * limit;

  const conditions = [];
  const values = [];

  if (q.length > 0) {
    values.push(`%${escapeLike(q)}%`);
    const p = `$${values.length}`;
    conditions.push(`(
      sem_acento(places.name) ILIKE sem_acento(${p}) ESCAPE '\\'
      OR sem_acento_endereco(places.street, places.neighborhood, places.locality, places.region, places.postcode) ILIKE sem_acento(${p}) ESCAPE '\\'
    )`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const baseJoin = `
    FROM (
      SELECT DISTINCT ON (menus.place_id)
        menus.id,
        menus.place_id,
        menus.currency,
        menus.created_at
      FROM menus
      ORDER BY menus.place_id, menus.created_at DESC, menus.id DESC
    ) AS latest
    INNER JOIN places ON places.id = latest.place_id
    ${whereClause}
  `;

  const [countResult, rowsResult] = await Promise.all([
    database.query({
      text: `SELECT count(*)::int AS total ${baseJoin};`,
      values,
    }),
    database.query({
      text: `
        ${menu.SELECT_PLACE_WITH_MENU},
        places.hidden_at,
        latest.currency
        ${baseJoin}
        ORDER BY latest.created_at DESC, places.id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      ;`,
      values: [...values, limit, offset],
    }),
  ]);

  return {
    items: rowsResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

const menuAdmin = {
  findPlaceMenus,
  listWithMenus,
};

export default menuAdmin;
