import database from "infra/database.js";
import controller from "infra/controller.js";
import authorization from "models/authorization.js";
import session from "models/session.js";
import user from "models/user.js";
import { ensureDevAdmin } from "infra/scripts/seed-dev-admin.mjs";

const ADMIN_PUBLIC_FIELDS = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  features: u.features,
});

// Proteção SSR das rotas `/admin/*`: valida sessão, renova por 7 dias e
// bloqueia qualquer conta sem a feature `"admin"`. Em desenvolvimento local,
// garante sessão pronta na primeira visita (a menos que o usuário tenha saído
// manualmente para testar login/recuperação).
export async function requireAdmin(
  context,
  { requiredFeature = null, fetchExtra = null } = {},
) {
  const { req, res } = context;

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  return await database.withSharedClient(async () => {
    let activeUser = null;
    let activeSession = null;

    const sessionToken = req.cookies?.session_id;
    if (sessionToken) {
      try {
        activeSession = await session.findOneValidByToken(sessionToken);
        activeUser = await user.findOneById(activeSession.user_id);
      } catch {
        controller.clearSessionCookie(res);
      }
    }

    const isDev = process.env.NODE_ENV === "development";
    if (!activeUser && isDev && req.cookies?.admin_dev_manual !== "1") {
      try {
        activeUser = await ensureDevAdmin();
        activeSession = await session.create(activeUser.id, {
          expirationMs: session.ADMIN_EXPIRATION_IN_MILLISECONDS,
        });
        controller.setSessionCookie(activeSession.token, res, {
          maxAgeSeconds: session.ADMIN_EXPIRATION_IN_MILLISECONDS / 1000,
        });
      } catch (error) {
        console.error(error);
      }
    }

    if (!activeUser || !activeSession) {
      return {
        redirect: {
          destination: "/admin/login",
          permanent: false,
        },
      };
    }

    const renewed = await session.renew(activeSession.id, {
      expirationMs: session.ADMIN_EXPIRATION_IN_MILLISECONDS,
    });
    controller.setSessionCookie(renewed.token, res, {
      maxAgeSeconds: session.ADMIN_EXPIRATION_IN_MILLISECONDS / 1000,
    });

    if (!authorization.can(activeUser, "admin")) {
      res.statusCode = 403;
      return {
        props: {
          adminUser: ADMIN_PUBLIC_FIELDS(activeUser),
          forbidden: true,
          forbiddenMessage:
            "Sua conta está autenticada, mas não possui permissão para acessar o painel administrativo.",
        },
      };
    }

    if (requiredFeature && !authorization.can(activeUser, requiredFeature)) {
      res.statusCode = 403;
      return {
        props: {
          adminUser: ADMIN_PUBLIC_FIELDS(activeUser),
          forbidden: true,
          forbiddenMessage: `Sua conta administrativa não possui a permissão "${requiredFeature}" para abrir esta seção.`,
        },
      };
    }

    const extra = fetchExtra ? await fetchExtra(activeUser) : {};
    return {
      props: {
        adminUser: ADMIN_PUBLIC_FIELDS(activeUser),
        forbidden: false,
        ...extra,
      },
    };
  });
}

// Em `/admin/login`, redireciona para `/admin` se já houver sessão admin válida.
export async function checkAdminGuest(context) {
  const { req, res } = context;
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );

  const isDev = process.env.NODE_ENV === "development";
  const sessionToken = req.cookies?.session_id;
  if (!sessionToken) {
    return { props: { isDev } };
  }

  return await database.withSharedClient(async () => {
    try {
      const activeSession = await session.findOneValidByToken(sessionToken);
      const activeUser = await user.findOneById(activeSession.user_id);
      if (authorization.can(activeUser, "admin")) {
        return {
          redirect: {
            destination: "/admin",
            permanent: false,
          },
        };
      }
    } catch {
      controller.clearSessionCookie(res);
    }

    return { props: { isDev } };
  });
}
