import { getServerSideProps } from "pages/cardapio/[place_id].js";
import place from "models/place.js";
import { NotFoundError, ServiceError } from "infra/errors.js";

jest.mock("models/place.js", () => ({
  __esModule: true,
  default: {
    findOneById: jest.fn(),
    shareCacheTag: jest.fn((id) => `place-share-${id}`),
  },
}));

function mockResponse() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader: jest.fn((name, value) => {
      headers[name] = value;
    }),
  };
}

afterEach(() => {
  jest.resetAllMocks();
});

describe("pages/cardapio/[place_id].js getServerSideProps", () => {
  test("with a visible place, returns only id and name and sets edge cache headers", async () => {
    const placeId = "27bdd19d-0f4c-4348-af8a-fe5589cab839";
    place.findOneById.mockResolvedValue({
      id: placeId,
      name: "Bar do Zé",
      street: "Rua Augusta, 100",
      hidden_at: null,
    });
    place.shareCacheTag.mockReturnValue(`place-share-${placeId}`);
    const res = mockResponse();

    const result = await getServerSideProps({
      params: { place_id: placeId },
      res,
    });

    expect(result).toEqual({
      props: {
        place: {
          id: placeId,
          name: "Bar do Zé",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(res.headers["Vercel-CDN-Cache-Control"]).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    expect(res.headers["Vercel-Cache-Tag"]).toBe(`place-share-${placeId}`);
  });

  test("with a hidden place, returns 404 fallback without exposing place details", async () => {
    const placeId = "27bdd19d-0f4c-4348-af8a-fe5589cab839";
    place.findOneById.mockResolvedValue({
      id: placeId,
      name: "Bar Fechado",
      hidden_at: new Date().toISOString(),
    });
    const res = mockResponse();

    const result = await getServerSideProps({
      params: { place_id: placeId },
      res,
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers["Cache-Control"]).toBe(
      "no-store, no-cache, max-age=0, must-revalidate",
    );
    expect(result).toEqual({
      props: {
        place: null,
      },
    });
  });

  test("with an unknown or invalid place id, returns 404 fallback", async () => {
    place.findOneById.mockRejectedValue(
      new NotFoundError({ message: "O lugar informado não foi encontrado." }),
    );
    const res = mockResponse();

    const result = await getServerSideProps({
      params: { place_id: "nao-existe" },
      res,
    });

    expect(res.statusCode).toBe(404);
    expect(result).toEqual({
      props: {
        place: null,
      },
    });
  });

  test("rethrows unexpected infrastructure errors", async () => {
    place.findOneById.mockRejectedValue(
      new ServiceError({ message: "Banco fora do ar" }),
    );
    const res = mockResponse();

    await expect(
      getServerSideProps({
        params: { place_id: "27bdd19d-0f4c-4348-af8a-fe5589cab839" },
        res,
      }),
    ).rejects.toThrow(ServiceError);
  });
});
