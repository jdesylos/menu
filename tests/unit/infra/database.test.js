import { Client } from "pg";
import database from "infra/database.js";
import { ServiceError } from "infra/errors.js";

// O banco não entra: o `pg` é trocado por um cliente de mentira que só anota
// o que lhe pedem. O que se afirma aqui é QUANTAS conexões cada caminho abre e
// se todas são fechadas — o que os testes de integração não enxergam, porque
// lá o servidor roda em outro processo.
jest.mock("pg", () => {
  const { EventEmitter } = require("node:events");

  class Client extends EventEmitter {
    static created = [];
    static failNextConnection = false;

    constructor() {
      super();
      this.queries = [];
      this.ended = false;
      Client.created.push(this);
    }

    async connect() {
      if (Client.failNextConnection) {
        Client.failNextConnection = false;
        throw new Error("connect ECONNREFUSED");
      }
    }

    async query(queryObject) {
      this.queries.push(queryObject);
      if (queryObject === "SELECT quebrado") {
        throw new Error("syntax error");
      }
      return { rows: [queryObject] };
    }

    async end() {
      this.ended = true;
      this.emit("end");
    }
  }

  return { Client };
});

beforeEach(() => {
  Client.created.length = 0;
  Client.failNextConnection = false;
});

describe("infra/database.js", () => {
  describe(".query()", () => {
    test("outside a request, each query opens and closes its own connection", async () => {
      await database.query("SELECT 1");
      await database.query("SELECT 2");

      expect(Client.created).toHaveLength(2);
      expect(Client.created.map((client) => client.queries)).toEqual([
        ["SELECT 1"],
        ["SELECT 2"],
      ]);
      expect(Client.created.every((client) => client.ended)).toBe(true);
    });
  });

  describe(".withSharedClient()", () => {
    test("with several queries", async () => {
      const returned = await database.withSharedClient(async () => {
        await database.query("SELECT 1");
        await database.query("SELECT 2");
        const last = await database.query("SELECT 3");

        // Aberta durante a requisição inteira, e não entre uma consulta e
        // outra.
        expect(Client.created[0].ended).toBe(false);
        return last.rows[0];
      });

      expect(returned).toBe("SELECT 3");
      expect(Client.created).toHaveLength(1);
      expect(Client.created[0].queries).toEqual([
        "SELECT 1",
        "SELECT 2",
        "SELECT 3",
      ]);
      expect(Client.created[0].ended).toBe(true);
    });

    test("with queries fired together", async () => {
      await database.withSharedClient(async () => {
        await Promise.all([
          database.query("SELECT 1"),
          database.query("SELECT 2"),
        ]);
      });

      // As duas esperaram a mesma abertura, em vez de abrir uma cada.
      expect(Client.created).toHaveLength(1);
      expect(Client.created[0].ended).toBe(true);
    });

    test("without any query", async () => {
      const returned = await database.withSharedClient(async () => "nada");

      // Rota que não vai ao banco não paga por conexão.
      expect(returned).toBe("nada");
      expect(Client.created).toHaveLength(0);
    });

    test("with a callback that throws", async () => {
      const failure = new Error("a rota recusou");

      await expect(
        database.withSharedClient(async () => {
          await database.query("SELECT 1");
          throw failure;
        }),
      ).rejects.toBe(failure);

      expect(Client.created).toHaveLength(1);
      expect(Client.created[0].ended).toBe(true);
    });

    test("with a query that fails", async () => {
      await database.withSharedClient(async () => {
        await expect(database.query("SELECT quebrado")).rejects.toThrow(
          ServiceError,
        );

        // Erro de consulta não é conexão caída: a seguinte usa a mesma.
        await database.query("SELECT 1");
      });

      expect(Client.created).toHaveLength(1);
      expect(Client.created[0].ended).toBe(true);
    });

    test("with a connection that drops between queries", async () => {
      await database.withSharedClient(async () => {
        await database.query("SELECT 1");

        // Conexão parada que cai avisa por evento. Sem ouvinte, este `emit`
        // lançaria — e num servidor derrubaria o processo.
        Client.created[0].emit("error", new Error("terminated unexpectedly"));

        await database.query("SELECT 2");
      });

      expect(Client.created).toHaveLength(2);
      expect(Client.created[1].queries).toEqual(["SELECT 2"]);
      expect(Client.created[1].ended).toBe(true);
    });

    test("with a connection that fails to open", async () => {
      Client.failNextConnection = true;

      await database.withSharedClient(async () => {
        await expect(database.query("SELECT 1")).rejects.toThrow(ServiceError);

        // A que não abriu não fica guardada: a consulta seguinte tenta outra.
        await database.query("SELECT 2");
      });

      expect(Client.created).toHaveLength(2);
      expect(Client.created[1].queries).toEqual(["SELECT 2"]);
      expect(Client.created[1].ended).toBe(true);
    });

    test("with a query left behind after the request ended", async () => {
      let leftBehind;

      await database.withSharedClient(async () => {
        await database.query("SELECT 1");
        leftBehind = new Promise((resolve) => setTimeout(resolve, 5)).then(() =>
          database.query("SELECT atrasado"),
        );
      });
      await leftBehind;

      // Ela ainda enxerga a requisição que a disparou, mas a conexão de lá já
      // fechou: abre a própria, e a fecha.
      expect(Client.created).toHaveLength(2);
      expect(Client.created[1].queries).toEqual(["SELECT atrasado"]);
      expect(Client.created.every((client) => client.ended)).toBe(true);
    });

    test("with a request inside another", async () => {
      await database.withSharedClient(async () => {
        await database.query("SELECT 1");
        await database.withSharedClient(async () => {
          await database.query("SELECT 2");
        });

        // A de dentro não fecha a conexão da de fora.
        expect(Client.created[0].ended).toBe(false);
        await database.query("SELECT 3");
      });

      expect(Client.created).toHaveLength(1);
      expect(Client.created[0].ended).toBe(true);
    });
  });
});
