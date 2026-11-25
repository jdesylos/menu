import menu from "models/menu.js";
import place from "models/place.js";
import database from "infra/database.js";
import cdn from "infra/cdn.js";
import { ConflictError } from "infra/errors.js";

jest.mock("infra/database.js", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("infra/cdn.js", () => ({
  __esModule: true,
  default: { forget: jest.fn() },
}));
jest.mock("models/place.js", () => {
  const actual = jest.requireActual("models/place.js");
  return {
    __esModule: true,
    default: {
      ...actual.default,
      findOneById: jest.fn(),
    },
  };
});

afterEach(() => {
  jest.resetAllMocks();
});

const ADMIN_USER = { id: "5c1e0a3d-8f2b-4a6e-9d71-3b0f6c2e8a14" };
const PLACE_ID = "27bdd19d-0f4c-4348-af8a-fe5589cab839";
const BASE_MENU_ID = "88e10183-cc0f-4767-adf1-c479eab8abfb";
const NEW_MENU_ID = "99e10183-cc0f-4767-adf1-c479eab8abfb";
const HIDDEN_PLACE = {
  id: PLACE_ID,
  latitude: -23.5505,
  longitude: -46.6333,
  hidden_at: new Date().toISOString(),
};

describe("models/menu.js .saveByAdmin()", () => {
  test("saves menu replacement freely even on hidden place without GPS or original authorship", async () => {
    place.findOneById.mockResolvedValue(HIDDEN_PLACE);

    database.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: BASE_MENU_ID,
            place_id: PLACE_ID,
            created_by: "00000000-0000-4000-8000-000000000001",
            sections: [
              {
                title: "Pratos",
                items: [{ id: "aaaa", name: "Prato antigo" }],
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: NEW_MENU_ID }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: NEW_MENU_ID,
            place_id: PLACE_ID,
            replaces_menu_id: BASE_MENU_ID,
            currency: "BRL",
            sections: [{ title: "Pratos", items: [{ name: "Novo Prato" }] }],
          },
        ],
      });

    const saved = await menu.saveByAdmin(ADMIN_USER, {
      place_id: PLACE_ID,
      replaces: BASE_MENU_ID,
      currency: "BRL",
      sections: [
        {
          title: "Pratos",
          items: [{ name: "Novo Prato", price_cents: 4500 }],
        },
      ],
    });

    expect(saved.id).toBe(NEW_MENU_ID);
    expect(cdn.forget).toHaveBeenCalledWith([
      ...place.cacheTagsOf(HIDDEN_PLACE),
      `menu-${PLACE_ID}`,
    ]);
  });

  test("returns 409 ConflictError when another revision raced ahead", async () => {
    place.findOneById.mockResolvedValue(HIDDEN_PLACE);
    database.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: BASE_MENU_ID, place_id: PLACE_ID, sections: [] }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      menu.saveByAdmin(ADMIN_USER, {
        place_id: PLACE_ID,
        replaces: BASE_MENU_ID,
        currency: "BRL",
        sections: [{ title: "Pratos", items: [{ name: "Teste" }] }],
      }),
    ).rejects.toThrow(ConflictError);
  });
});
