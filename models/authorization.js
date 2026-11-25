import { InternalServerError } from "infra/errors.js";
import { ADMIN_PANEL_FEATURES } from "models/features.js";

const availableFeatures = [
  // ADMIN
  // Marcador de quem modera e administra o painel. Não concede nada por si,
  // como no repositório judhagsan: cada ação continua exigindo a sua feature
  // granular (`manage:place`, `manage:menu`, etc.).
  "admin",
  "manage:admins",

  // USER
  "create:user",
  "read:user",
  "read:user:self",
  "read:user:admin",
  "update:user",
  "update:user:others",
  "erase:user:others",

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

  // SUPPORT
  // Atender solicitações de locais faltantes e pedidos de ajuda pelo painel.
  "manage:support",
  // Chave de formatação do `filterOutput` para solicitações de suporte.
  "read:support_request",

  // MENU
  // Mandar o cardápio de um lugar, e antes disso ler a folha: a rota de
  // leitura (`POST /api/v1/vision/read`) exige a mesma feature, porque quem
  // não pode mandar não tem por que gastar a leitura. Toda conta ativada tem.
  "create:menu",
  // Chave de formatação do `filterOutput`, como a `read:place_suggestion`:
  // ler o cardápio de um lugar é público, e nenhuma rota exige esta feature.
  "read:menu",
  // Editar ou substituir qualquer cardápio pelo painel administrativo, sem
  // trava de distância ou autoria original.
  "manage:menu",
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

  if (feature === "read:user:admin") {
    return {
      id: resource.id,
      username: resource.username,
      email: resource.email,
      features: resource.features,
      created_at: resource.created_at,
      updated_at: resource.updated_at,
      deleted_at: resource.deleted_at ?? null,
    };
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

  if (feature === "read:support_request") {
    if (can(user, "manage:support")) {
      return {
        id: resource.id,
        category: resource.category,
        status: resource.status,
        user_id: resource.user_id ?? null,
        user_username: resource.user_username ?? null,
        contact_name: resource.contact_name ?? null,
        contact_email: resource.contact_email ?? null,
        account_identifier: resource.account_identifier ?? null,
        subject: resource.subject ?? null,
        message: resource.message ?? null,
        place_name: resource.place_name ?? null,
        approximate_address: resource.approximate_address ?? null,
        latitude: resource.latitude ?? null,
        longitude: resource.longitude ?? null,
        metadata: resource.metadata ?? {},
        resolved_place_id: resource.resolved_place_id ?? null,
        resolved_place_name: resource.resolved_place_name ?? null,
        handled_by: resource.handled_by ?? null,
        handled_username: resource.handled_username ?? null,
        resolution_note: resource.resolution_note ?? null,
        handled_at: resource.handled_at ?? null,
        resolved_at: resource.resolved_at ?? null,
        created_at: resource.created_at,
        updated_at: resource.updated_at,
      };
    }

    if (user.id && resource.user_id === user.id) {
      return {
        id: resource.id,
        category: resource.category,
        status: resource.status,
        subject: resource.subject ?? null,
        message: resource.message ?? null,
        place_name: resource.place_name ?? null,
        approximate_address: resource.approximate_address ?? null,
        latitude: resource.latitude ?? null,
        longitude: resource.longitude ?? null,
        resolved_place_id: resource.resolved_place_id ?? null,
        resolution_note: resource.resolution_note ?? null,
        resolved_at: resource.resolved_at ?? null,
        created_at: resource.created_at,
        updated_at: resource.updated_at,
      };
    }
  }

  // Quem mandou não sai: o cardápio é do lugar, e quem lê não tem por que
  // saber de que conta ele veio. O que sai é só se QUEM LÊ pode mudar o
  // texto dele (`can_edit`), quando a rota o calculou — ver
  // `menu.canEditText` —, e onde fica o lugar, quando a leitura o trouxe.
  if (feature === "read:menu") {
    return {
      id: resource.id,
      place_id: resource.place_id,
      place_name: resource.place_name,
      currency: resource.currency,
      sections: resource.sections,
      created_at: resource.created_at,
      can_edit: resource.can_edit,
      place_location: resource.place_location,
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
  ADMIN_PANEL_FEATURES,
  availableFeatures,
  can,
  filterOutput,
};

export default authorization;
