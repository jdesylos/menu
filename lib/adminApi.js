export async function apiFetch(url, options = {}) {
  const config = {
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  };

  if (
    config.body &&
    typeof config.body === "object" &&
    !(config.body instanceof FormData)
  ) {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || `Erro inesperado (${response.status}).`;
    const action = payload?.action ? ` ${payload.action}` : "";
    const error = new Error(`${message}${action}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatShortDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatPriceCents(cents, currency = "BRL") {
  if (cents === null || cents === undefined) return "Sem preço";
  const symbols = { BRL: "R$", USD: "US$", EUR: "€" };
  const prefix = symbols[currency] || currency;
  const formatted = (Number(cents) / 100).toFixed(2).replace(".", ",");
  return `${prefix} ${formatted}`;
}

export function centsToInput(cents) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2).replace(".", ",");
}

export function parsePriceToCents(raw) {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return null;
  const normalized = cleaned.replace(/[R$\s]/g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    return NaN;
  }
  return Math.round(value * 100);
}

export const FEATURE_LABELS = {
  admin: "Acesso ao painel",
  "manage:place": "Gerenciar locais e sugestões",
  "manage:menu": "Editar cardápios",
  "manage:support": "Atender solicitações e ajuda",
  "read:user:admin": "Consultar usuários",
  "update:user:others": "Editar contas de usuários",
  "erase:user:others": "Excluir contas de usuários",
  "manage:admins": "Promover e gerenciar admins",
};

export function hasFeature(user, feature) {
  return Array.isArray(user?.features) && user.features.includes(feature);
}
