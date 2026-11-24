// Listas compartilhadas de permissões (`features`) em módulo sem dependências
// para uso consistente tanto pela aplicação Next.js quanto pelos scripts CLI.

export const ACTIVATED_FEATURES = [
  "create:session",
  "read:session",
  "update:user",
  "create:place",
  "update:place",
  "create:menu",
];

export const ADMIN_PANEL_FEATURES = [
  "admin",
  "manage:place",
  "manage:menu",
  "manage:support",
  "read:user:admin",
  "update:user:others",
  "erase:user:others",
  "manage:admins",
];

export const ALL_ADMIN_FEATURES = [
  ...new Set([...ACTIVATED_FEATURES, ...ADMIN_PANEL_FEATURES]),
];
