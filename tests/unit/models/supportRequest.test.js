import database from "infra/database.js";
import place from "models/place.js";
import supportRequest from "models/supportRequest.js";

jest.mock("infra/database.js", () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock("models/place.js", () => ({
  UUID_PATTERN:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  findOneById: jest.fn(),
}));

describe("models/supportRequest.js", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SUPPORT_CONTACT_EMAIL;
    delete process.env.SUPPORT_CONTACT_URL;
  });

  test("getSupportInfo returns default contact and guidance and respects env overrides", () => {
    const defaultInfo = supportRequest.getSupportInfo();
    expect(defaultInfo.contact.email).toBe("contato@menuspoiler.com.br");
    expect(defaultInfo.contact.secondary_url).toBeNull();
    expect(defaultInfo.categories.map((c) => c.id)).toEqual([
      "missing_place",
      "account_help",
      "general_help",
    ]);
    expect(defaultInfo.guidance.length).toBeGreaterThanOrEqual(2);

    process.env.SUPPORT_CONTACT_EMAIL = "ajuda@menuspoiler.com.br";
    process.env.SUPPORT_CONTACT_URL = "https://wa.me/5511999999999";

    const customInfo = supportRequest.getSupportInfo();
    expect(customInfo.contact).toEqual({
      email: "ajuda@menuspoiler.com.br",
      secondary_url: "https://wa.me/5511999999999",
    });
  });

  test("create allows missing_place without coordinates and without login", async () => {
    database.query.mockResolvedValue({
      rows: [
        {
          id: "req-1",
          category: "missing_place",
          status: "open",
          place_name: "Boteco Central",
          approximate_address: "Perto da praça da Sé",
          latitude: null,
          longitude: null,
        },
      ],
    });

    const created = await supportRequest.create(
      { features: ["create:session"] },
      {
        category: "missing_place",
        place_name: "Boteco Central",
        approximate_address: "Perto da praça da Sé",
      },
    );

    expect(created.id).toBe("req-1");
    expect(database.query).toHaveBeenCalledTimes(1);
    const values = database.query.mock.calls[0][0].values;
    expect(values[0]).toBe("missing_place");
    expect(values[1]).toBeNull();
    expect(values[7]).toBe("Boteco Central");
    expect(values[8]).toBe("Perto da praça da Sé");
    expect(values[9]).toBeNull();
    expect(values[10]).toBeNull();
  });

  test("create validates coordinate pairs and rejects unknown sensitive fields like password", async () => {
    await expect(
      supportRequest.create(null, {
        category: "missing_place",
        place_name: "Café",
        approximate_address: "Rua X",
        latitude: -23.55,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      supportRequest.create(null, {
        category: "missing_place",
        place_name: "Café",
        approximate_address: "Rua X",
        latitude: 40.71,
        longitude: -74.0,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      supportRequest.create(null, {
        category: "account_help",
        contact_email: "pessoa@exemplo.com",
        message: "Não consigo entrar",
        password: "nao deveria existir",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(database.query).not.toHaveBeenCalled();
  });

  test("create requires contact_email for anonymous help requests", async () => {
    await expect(
      supportRequest.create(
        { features: [] },
        {
          category: "account_help",
          account_identifier: "joao",
          message: "Esqueci meu e-mail",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(database.query).not.toHaveBeenCalled();
  });

  test("updateByAdmin checks place existence before resolving and records resolution", async () => {
    const reqId = "11111111-1111-4111-8111-111111111111";
    const placeId = "22222222-2222-4222-8222-222222222222";
    place.findOneById.mockResolvedValue({ id: placeId, name: "Padaria Sul" });

    database.withTransaction.mockImplementation(async (callback) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            rowCount: 1,
            rows: [{ id: reqId, status: "open", resolution_note: null }],
          })
          .mockResolvedValueOnce({
            rowCount: 1,
            rows: [
              {
                id: reqId,
                status: "resolved",
                resolved_place_id: placeId,
              },
            ],
          }),
      };
      return await callback(client);
    });

    database.query.mockResolvedValueOnce({
      rows: [
        {
          id: reqId,
          status: "resolved",
          resolved_place_id: placeId,
          resolved_place_name: "Padaria Sul",
        },
      ],
    });

    const result = await supportRequest.updateByAdmin(
      { id: "admin-1" },
      reqId,
      {
        status: "resolved",
        resolved_place_id: placeId,
        resolution_note: "Local cadastrado.",
      },
    );

    expect(place.findOneById).toHaveBeenCalledWith(placeId);
    expect(result.previous.status).toBe("open");
    expect(result.updated.status).toBe("resolved");
    expect(result.updated.resolved_place_name).toBe("Padaria Sul");
  });
});
