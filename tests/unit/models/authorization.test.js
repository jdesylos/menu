import authorization from "models/authorization.js";
import { InternalServerError } from "infra/errors.js";

describe("models/authorization.js", () => {
  describe(".can()", () => {
    test("without `user`", () => {
      expect(() => {
        authorization.can();
      }).toThrow(InternalServerError);
    });

    test("without `user.features`", () => {
      const createdUser = {
        username: "UserWithoutFeatures",
      };

      expect(() => {
        authorization.can(createdUser);
      }).toThrow(InternalServerError);
    });

    test("with unknown `feature`", () => {
      const createdUser = {
        features: [],
      };

      expect(() => {
        authorization.can(createdUser, "unknown:feature");
      }).toThrow(InternalServerError);
    });

    test("with valid `user` and known `feature`", () => {
      const createdUser = {
        features: ["create:user"],
      };

      expect(authorization.can(createdUser, "create:user")).toBe(true);
    });
  });

  describe(".filterOutput()", () => {
    test("without `user`", () => {
      expect(() => {
        authorization.filterOutput();
      }).toThrow(InternalServerError);
    });

    test("without `user.features`", () => {
      const createdUser = {
        username: "UserWithoutFeatures",
      };

      expect(() => {
        authorization.filterOutput(createdUser);
      }).toThrow(InternalServerError);
    });

    test("with unknown `feature`", () => {
      const createdUser = {
        features: [],
      };

      expect(() => {
        authorization.filterOutput(createdUser, "unknown:feature");
      }).toThrow(InternalServerError);
    });

    test("with valid `user`, known `feature` but no `resource`", () => {
      const createdUser = {
        features: ["read:user"],
      };

      expect(() => {
        authorization.filterOutput(createdUser, "read:user");
      }).toThrow(InternalServerError);
    });

    test("with valid `user`, known `feature` and `resource`", () => {
      const createdUser = {
        features: ["read:user"],
      };

      const resource = {
        id: 1,
        username: "resource",
        features: ["read:user"],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        email: "resource@resource.com",
        password: "resource",
      };

      const result = authorization.filterOutput(
        createdUser,
        "read:user",
        resource,
      );

      // Sem `features` e sem `email`: a lista de features é o mapa de
      // privilégios da conta, e não sai na visão de um usuário sobre outro.
      expect(result).toEqual({
        id: 1,
        username: "resource",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    });

    test("with `read:user:admin`, exposes administrative fields without password", () => {
      const adminUser = {
        features: ["admin", "read:user:admin"],
      };

      const resource = {
        id: 1,
        username: "resource",
        email: "resource@resource.com",
        features: ["create:session"],
        password: "hashed-password",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
      };

      const result = authorization.filterOutput(
        adminUser,
        "read:user:admin",
        resource,
      );

      expect(result).toEqual({
        id: 1,
        username: "resource",
        email: "resource@resource.com",
        features: ["create:session"],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
      });
      expect(result).not.toHaveProperty("password");
    });

    test("with `read:support_request`, limits fields for owner and exposes admin context for `manage:support`", () => {
      const resource = {
        id: "req-1",
        category: "account_help",
        status: "open",
        user_id: "user-1",
        user_username: "maria",
        contact_name: "Maria",
        contact_email: "maria@exemplo.com",
        account_identifier: "maria",
        subject: "Não consigo entrar",
        message: "Perdi meu acesso",
        place_name: null,
        approximate_address: null,
        latitude: null,
        longitude: null,
        metadata: { internal: true },
        resolved_place_id: null,
        resolved_place_name: null,
        handled_by: "admin-1",
        handled_username: "admin",
        resolution_note: "Em análise",
        handled_at: "2026-11-24T12:00:00.000Z",
        resolved_at: null,
        created_at: "2026-11-24T11:00:00.000Z",
        updated_at: "2026-11-24T12:00:00.000Z",
      };

      const ownerView = authorization.filterOutput(
        { id: "user-1", features: ["read:session"] },
        "read:support_request",
        resource,
      );
      expect(ownerView).not.toHaveProperty("handled_by");
      expect(ownerView).not.toHaveProperty("metadata");
      expect(ownerView.status).toBe("open");

      const strangerView = authorization.filterOutput(
        { id: "user-2", features: ["read:session"] },
        "read:support_request",
        resource,
      );
      expect(strangerView).toBeUndefined();

      const adminView = authorization.filterOutput(
        { id: "admin-1", features: ["admin", "manage:support"] },
        "read:support_request",
        resource,
      );
      expect(adminView.handled_by).toBe("admin-1");
      expect(adminView.contact_email).toBe("maria@exemplo.com");
      expect(adminView.account_identifier).toBe("maria");
    });
  });
});
