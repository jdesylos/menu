// A busca por nome passa a ignorar acento: "cafe" acha "Café", "acai" acha
// "Açaí", e "sao joao" acha "São João".
//
// # Por que agora
//
// O teclado do Android não entrega acento ao aplicativo. O Gboard manda o "é"
// escolhido segurando o "e" como um evento de TEXTO, e a NativeActivity só
// repassa ao código nativo o código da tecla — que é zero. Sem isto, nenhum
// lugar com acento no nome podia ser achado por quem usa Android: "cafe" não
// casava com nenhum "Café", porque ILIKE ignora maiúscula, mas não acento.
//
// # Por que uma função, e não o "unaccent" direto na consulta
//
// A busca é servida pelo índice de trigramas do nome. Comparar
// "unaccent(name)" com o índice de "name" o deixa de fora, e cada letra
// digitada viraria uma varredura dos ~600 mil lugares. O índice precisa ser
// sobre a mesma expressão da consulta — e índice só aceita função IMUTÁVEL, o
// que o "unaccent" não é: ele depende do dicionário configurado na sessão.
// "sem_acento" fixa o dicionário pelo nome qualificado, e aí o resultado só
// depende do texto, que é o que "IMMUTABLE" promete.
//
// O índice antigo, sobre "name", sai: a busca era a única consulta que o
// usava, e ela passa a usar o novo.
exports.up = (pgm) => {
  // "unaccent" vem no contrib do Postgres, disponível no Neon e na imagem do
  // compose, como o "pg_trgm" que o índice anterior já usava.
  pgm.createExtension("unaccent", { ifNotExists: true });

  pgm.sql(`
    CREATE FUNCTION sem_acento(texto text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
    AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, texto) $$;
  `);

  pgm.dropIndex("places", "name", { name: "places_name_trgm_index" });

  pgm.sql(`
    CREATE INDEX places_name_sem_acento_trgm_index
    ON places
    USING gin (sem_acento(name) gin_trgm_ops);
  `);
};

exports.down = false;
