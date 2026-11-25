jest.mock("infra/database.js", () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock("models/emailChange.js", () => ({
  requestChange: jest.fn(),
}));
jest.mock("models/rateLimit.js", () => ({
  check: jest.fn(),
}));
jest.mock("models/supportRequest.js", () => ({
  createRecoveryEscalation: jest.fn(),
}));
jest.mock("models/auditLog.js", () => ({
  record: jest.fn(),
}));

import { ValidationError } from "infra/errors.js";
import accountRecovery from "models/accountRecovery.js";
import { ACTIVATED_FEATURES, ALL_ADMIN_FEATURES } from "models/features.js";

function makeActiveUser(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    username: "maria_sp",
    email: "maria.antiga@menuspoiler.com.br",
    features: [...ACTIVATED_FEATURES],
    created_at: "2026-09-15T15:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("models/accountRecovery", () => {
  test(".getQuestions() omits passwords and exposes public fields", () => {
    const schema = accountRecovery.getQuestions();
    const ids = schema.fields.map((f) => f.id);
    expect(ids).toEqual([
      "account_identifier",
      "new_email",
      "known_old_email",
      "submitted_place_names",
      "activity_locality",
      "created_month",
      "notes",
    ]);
    expect(ids.some((id) => /password|senha/i.test(id))).toBe(false);
    expect(schema.never_request[0]).toMatch(/senhas/i);
  });

  test(".parseInput() validates required fields, rejects passwords and normalizes inputs", () => {
    expect(() =>
      accountRecovery.parseInput({
        account_identifier: "maria_sp",
        new_email: "maria.nova@menuspoiler.com.br",
        previous_password: "secret",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      accountRecovery.parseInput({
        account_identifier: "maria_sp",
        new_email: "maria.nova@menuspoiler.com.br",
        senha_anterior: "secret",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      accountRecovery.parseInput({
        account_identifier: "maria_sp",
        new_email: "maria.nova@menuspoiler.com.br",
        created_month: "2026-13",
      }),
    ).toThrow(ValidationError);

    expect(() =>
      accountRecovery.parseInput({
        account_identifier: "maria_sp",
        new_email: "maria.nova@menuspoiler.com.br",
        submitted_place_names: ["A", "B", "C", "D", "E", "F"],
      }),
    ).toThrow(ValidationError);

    const parsed = accountRecovery.parseInput({
      account_identifier: " maria_sp ",
      new_email: "Maria.Nova@MenuSpoiler.com.br",
      known_old_email: "Maria.Antiga@MenuSpoiler.com.br",
      submitted_place_names: [
        "Café da Praça",
        "cafe da praca",
        "Cantina Boa Mesa",
      ],
      activity_locality: "São Paulo",
      created_month: "2026-09",
    });

    expect(parsed.newEmail).toBe("Maria.Nova@MenuSpoiler.com.br");
    expect(parsed.submittedPlaces).toHaveLength(2);
    expect(parsed.submittedPlaces[0].normalized).toBe("cafe da praca");
  });

  test(".evaluateOwnership() refuses auto-approval on missing/unactivated/admin accounts or zero private history", () => {
    const input = accountRecovery.parseInput({
      account_identifier: "maria_sp",
      new_email: "nova@menuspoiler.com.br",
      known_old_email: "maria.antiga@menuspoiler.com.br",
      submitted_place_names: ["Cantina do Porto"],
      created_month: "2026-09",
    });

    expect(accountRecovery.evaluateOwnership(null, {}, input).reason).toBe(
      "account_not_found_or_inactive",
    );

    const unactivated = makeActiveUser({
      features: ["read:activation_token"],
    });
    expect(
      accountRecovery.evaluateOwnership(
        unactivated,
        { privatePlaceNames: ["cantina do porto"], localities: new Set() },
        input,
      ).reason,
    ).toBe("unactivated_account");

    const adminUser = makeActiveUser({
      features: [...ALL_ADMIN_FEATURES],
    });
    expect(
      accountRecovery.evaluateOwnership(
        adminUser,
        {
          privatePlaceNames: ["cantina do porto"],
          localities: new Set(["sao paulo"]),
        },
        input,
      ).reason,
    ).toBe("admin_account_requires_manual_review");

    // Conta sem histórico privado nunca libera troca apenas com created_month + e-mail.
    const activeNoHistory = makeActiveUser();
    const resNoHistory = accountRecovery.evaluateOwnership(
      activeNoHistory,
      { privatePlaceNames: [], localities: new Set() },
      input,
    );
    expect(resNoHistory.approved).toBe(false);
    expect(resNoHistory.reason).toBe("insufficient_private_history");
  });

  test(".evaluateOwnership() blocks generic place words and approves only on combined private signals", () => {
    const active = makeActiveUser();
    const signalsSingle = {
      privatePlaceNames: ["cantina do porto"],
      localities: new Set(["sao paulo"]),
    };

    const genericOnly = accountRecovery.parseInput({
      account_identifier: "maria_sp",
      new_email: "nova@menuspoiler.com.br",
      known_old_email: "maria.antiga@menuspoiler.com.br",
      submitted_place_names: ["restaurante", "bar", "cafe"],
      created_month: "2026-09",
    });
    expect(
      accountRecovery.evaluateOwnership(active, signalsSingle, genericOnly),
    ).toMatchObject({
      approved: false,
      reason: "inconclusive_answers",
    });

    const missingReinforcement = accountRecovery.parseInput({
      account_identifier: "maria_sp",
      new_email: "nova@menuspoiler.com.br",
      known_old_email: "maria.antiga@menuspoiler.com.br",
      submitted_place_names: ["Cantina do Porto"],
    });
    expect(
      accountRecovery.evaluateOwnership(
        active,
        signalsSingle,
        missingReinforcement,
      ),
    ).toMatchObject({
      approved: false,
      reason: "inconclusive_answers",
    });

    const validSingle = accountRecovery.parseInput({
      account_identifier: "maria_sp",
      new_email: "nova@menuspoiler.com.br",
      known_old_email: "maria.antiga@menuspoiler.com.br",
      submitted_place_names: ["cantina do porto"],
      created_month: "2026-10",
    });
    expect(
      accountRecovery.evaluateOwnership(active, signalsSingle, validSingle),
    ).toMatchObject({
      approved: true,
      reason: "verified_ownership",
    });

    const signalsMultiple = {
      privatePlaceNames: ["bar da lapa", "padaria santa clara"],
      localities: new Set(["sao paulo"]),
    };
    const validMultiple = accountRecovery.parseInput({
      account_identifier: "maria_sp",
      new_email: "nova@menuspoiler.com.br",
      known_old_email: "maria.antiga@menuspoiler.com.br",
      submitted_place_names: ["Bar da Lapa", "Santa Clara"],
    });
    expect(
      accountRecovery.evaluateOwnership(active, signalsMultiple, validMultiple),
    ).toMatchObject({
      approved: true,
      reason: "verified_ownership",
    });
  });
});
