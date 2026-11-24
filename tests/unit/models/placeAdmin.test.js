import place from "models/place.js";
import database from "infra/database.js";
import cdn from "infra/cdn.js";
import { ConflictError, ValidationError } from "infra/errors.js";

jest.mock("infra/database.js", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    withTransaction: jest.fn(),
  },
}));

jest.mock("infra/cdn.js", () => ({
  __esModule: true,
  default: { forget: jest.fn() },
}));

afterEach(() => {
  jest.resetAllMocks();
});

const PLACE_ID = "27bdd19d-0f4c-4348-af8a-fe5589cab839";
const POS = { latitude: -23.56916, longitude: -46.71323 };

describe("models/place.js admin methods", () => {
  test(".createByAdmin() validates coordinates in Brazil and purges tile cache", async () => {
    await expect(
      place.createByAdmin({
        name: "Fora do Brasil",
        latitude: 40.7,
        longitude: -74.0,
      }),
    ).rejects.toThrow(ValidationError);

    database.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: PLACE_ID, name: "Bar Admin", ...POS }],
    });

    const created = await place.createByAdmin({
      name: "Bar Admin",
      street: "Rua Teste, 10",
      ...POS,
    });

    expect(created.name).toBe("Bar Admin");
    expect(cdn.forget).toHaveBeenCalledTimes(1);
    expect(cdn.forget).toHaveBeenCalledWith(place.cacheTagsOf(POS));
  });

  test(".updateByAdmin() updates columns + overrides and purges before/after caches", async () => {
    database.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: PLACE_ID, name: "Antes", ...POS }],
    });

    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...POS, overrides: { category: "bar" } }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: PLACE_ID, name: "Depois", ...POS }],
        }),
    };
    database.withTransaction.mockImplementation(async (cb) => await cb(client));

    const updated = await place.updateByAdmin(PLACE_ID, {
      name: "Depois",
      street: "",
    });

    expect(updated.name).toBe("Depois");
    const updateCall = client.query.mock.calls[1][0];
    expect(JSON.parse(updateCall.values[1])).toEqual({
      category: "bar",
      name: "Depois",
    });
    expect(cdn.forget).toHaveBeenCalledWith(
      expect.arrayContaining([
        ...place.cacheTagsOf(POS),
        place.shareCacheTag(PLACE_ID),
        `menu-${PLACE_ID}`,
      ]),
    );
  });

  test(".erasePhysicalByAdmin() rejects imported places or places with linked menus", async () => {
    database.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: PLACE_ID, source: "overture", ...POS }],
    });
    await expect(place.erasePhysicalByAdmin(PLACE_ID)).rejects.toThrow(
      ConflictError,
    );

    database.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: PLACE_ID, source: "admin", ...POS }],
    });
    const client = {
      query: jest.fn().mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ has_menus: true, has_suggestions: false }],
      }),
    };
    database.withTransaction.mockImplementation(async (cb) => await cb(client));

    await expect(place.erasePhysicalByAdmin(PLACE_ID)).rejects.toThrow(
      ConflictError,
    );
  });

  test(".findWithinViewportForAdmin() validates bounds/span and queries viewport places", async () => {
    await expect(
      place.findWithinViewportForAdmin({
        south: -23.54,
        north: -23.55,
        west: -46.64,
        east: -46.62,
      }),
    ).rejects.toMatchObject({ name: "ValidationError" });

    await expect(
      place.findWithinViewportForAdmin({
        south: -23.7,
        north: -23.5,
        west: -46.64,
        east: -46.62,
      }),
    ).rejects.toMatchObject({ name: "ValidationError" });

    const mockRows = [
      {
        id: PLACE_ID,
        name: "Bistrô Viewport",
        category: "restaurant",
        latitude: -23.55,
        longitude: -46.63,
        street: "Rua Teste, 10",
        neighborhood: "Centro",
        locality: "São Paulo",
        hidden_at: null,
        hidden_reason: null,
        has_menu: true,
      },
    ];
    database.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: mockRows,
    });

    const rows = await place.findWithinViewportForAdmin({
      south: -23.56,
      north: -23.54,
      west: -46.64,
      east: -46.62,
    });

    expect(rows).toEqual(mockRows);
    expect(database.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("EXISTS"),
        values: [-23.56, -23.54, -46.64, -46.62, 300],
      }),
    );
  });
});
