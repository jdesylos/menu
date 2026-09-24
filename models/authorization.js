import { InternalServerError } from "infra/errors.js";

const availableFeatures = [
  // ADMIN
  // Marcador de quem modera o mapa. Não concede nada por si, como no
  // repositório judhagsan: cada ação continua exigindo a sua feature granular
  // (`manage:place` e companhia). "Enxerga a moderação" e "pode aceitar uma
  // sugestão" são perguntas diferentes, e quem ganhar uma por um motivo
  // pontual não herda a outra sem ninguém ter decidido isso.
  "admin",

  // USER
  "create:user",
  "read:user",
  "read:user:self",
  "update:user",
  "update:user:others",

  // SESSION
  "create:session",
  "read:session",

  // ACTIVATION_TOKEN
  "read:activation_token",

  // MIGRATION
  "create:migration",
  "read:migration",

  // STATUS
  "read:status",
  "read:status:all",

  // PLACE
  // Sugerir um lugar que o mapa não tem. Toda conta ativada tem.
  "create:place",
  // Sugerir correção, "fechou" ou "é duplicata" num lugar que existe. Toda
  // conta ativada tem.
  "update:place",
  // Aceitar e recusar sugestões — o que muda o mapa de todo mundo. Vai para
  // quem tem `admin`, por migration, e não é efeito colateral de `admin`.
  "manage:place",
  // Chave de formatação do `filterOutput`, não permissão: nenhuma rota exige
  // esta feature, e concedê-la a alguém não muda nada. Fica na lista porque
  // `validateFeature()` recusa nome desconhecido — como o `read:user` do
  // repositório judhagsan.
  "read:place_suggestion",
];

function can(user, feature, resource) {
  validateUser(user);
  validateFeature(feature);

  let authorized = false;

  if (user.features.includes(feature)) {
    authorized = true;
  }

  if (feature === "update:user" && resource) {
    authorized = false;

    if (user.id === resource.id || can(user, "update:user:others")) {
      authorized = true;
    }
  }

  return authorized;
}

function filterOutput(user, feature, resource) {
  validateUser(user);
  validateFeature(feature);
  validateResource(resource);

  // A visão de um usuário sobre OUTRO não traz `features`: a lista é o mapa
  // de privilégios da conta, e exposta diria a qualquer um quem pode rodar
  // migration ou mexer em outra conta — em quem mirar antes de tentar
  // qualquer coisa. Quem precisa dela lê a própria conta, por
  // `read:user:self`. Veio do repositório judhagsan.
  if (feature === "read:user") {
    return {
      id: resource.id,
      username: resource.username,
      created_at: resource.created_at,
      updated_at: resource.updated_at,
    };
  }

  if (feature === "read:user:self") {
    if (user.id === resource.id) {
      return {
        id: resource.id,
        username: resource.username,
        email: resource.email,
        features: resource.features,
        created_at: resource.created_at,
        updated_at: resource.updated_at,
      };
    }
  }

  if (feature === "read:session") {
    if (user.id === resource.user_id) {
      return {
        id: resource.id,
        token: resource.token,
        user_id: resource.user_id,
        created_at: resource.created_at,
        updated_at: resource.updated_at,
        expires_at: resource.expires_at,
      };
    }
  }

  if (feature === "read:activation_token") {
    return {
      id: resource.id,
      user_id: resource.user_id,
      created_at: resource.created_at,
      updated_at: resource.updated_at,
      expires_at: resource.expires_at,
      used_at: resource.used_at,
    };
  }

  // Quem mandou a sugestão sai só pelo id: username e email de quem sugere não
  // são assunto de quem revisa.
  if (feature === "read:place_suggestion") {
    return {
      id: resource.id,
      kind: resource.kind,
      place_id: resource.place_id,
      duplicate_of: resource.duplicate_of,
      changes: resource.changes,
      status: resource.status,
      created_by: resource.created_by,
      reviewed_by: resource.reviewed_by,
      reviewed_at: resource.reviewed_at,
      created_at: resource.created_at,
      updated_at: resource.updated_at,
    };
  }

  if (feature === "read:migration") {
    return resource.map((migration) => {
      return {
        path: migration.path,
        name: migration.name,
        timestamp: migration.timestamp,
      };
    });
  }

  if (feature === "read:status") {
    const output = {
      updated_at: resource.updated_at,
      dependencies: {
        database: {
          max_connections: resource.dependencies.database.max_connections,
          opened_connections: resource.dependencies.database.opened_connections,
        },
      },
    };

    if (can(user, "read:status:all")) {
      output.dependencies.database.version =
        resource.dependencies.database.version;
    }

    return output;
  }
}

function validateUser(user) {
  if (!user || !user.features) {
    throw new InternalServerError({
      cause: "É necessário fornecer `user` no model `authorization`.",
    });
  }
}

function validateFeature(feature) {
  if (!feature || !availableFeatures.includes(feature)) {
    throw new InternalServerError({
      cause:
        "É necessário fornecer uma `feature` conhecida no model `authorization`.",
    });
  }
}

function validateResource(resource) {
  if (!resource) {
    throw new InternalServerError({
      cause:
        "É necessário fornecer um `resource` em `authorization.filterOutput()`.",
    });
  }
}

const authorization = {
  can,
  filterOutput,
};

export default authorization;
