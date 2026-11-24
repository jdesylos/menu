import { createRouter } from "next-connect";
import controller from "infra/controller.js";
import auditLog from "models/auditLog.js";
import authorization from "models/authorization.js";
import emailChange from "models/emailChange.js";
import {
  ACTIVATED_FEATURES,
  ADMIN_PANEL_FEATURES,
  ALL_ADMIN_FEATURES,
} from "models/features.js";
import user from "models/user.js";
import { ForbiddenError, ValidationError } from "infra/errors.js";

export default createRouter()
  .use(controller.shareDatabaseConnection)
  .use(controller.injectAnonymousOrUser)
  .get(
    controller.canRequest("admin"),
    controller.canRequest("read:user:admin"),
    getHandler,
  )
  .patch(
    controller.canRequest("admin"),
    controller.canRequest("read:user:admin"),
    controller.canRequest("update:user:others"),
    patchHandler,
  )
  .delete(
    controller.canRequest("admin"),
    controller.canRequest("erase:user:others"),
    deleteHandler,
  )
  .handler(controller.errorHandlers);

async function getHandler(request, response) {
  const detail = await user.findAdminDetailById(request.query.id);
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(detail);
}

async function patchHandler(request, response) {
  const actor = request.context.user;
  const targetId = request.query.id;
  const body =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? request.body
      : {};
  const ip = controller.getClientIp(request);

  if (!user.UUID_PATTERN.test(String(targetId))) {
    await user.findAdminDetailById(targetId);
  }
  const targetUser = await user.findOneById(targetId);

  if (targetUser.deleted_at) {
    throw new ValidationError({
      message: "Não é possível alterar uma conta já excluída.",
      action: "Selecione uma conta ativa.",
    });
  }

  if (body.action === "change_username") {
    const updated = await user.changeUsername({
      userId: targetUser.id,
      newUsername: body.username,
      currentUser: targetUser,
    });

    await auditLog.record({
      action: "admin.user_username_changed",
      actorUserId: actor.id,
      targetUserId: targetUser.id,
      ip,
      metadata: {
        previous_username: targetUser.username,
        new_username: updated.username,
      },
    });

    response.setHeader("Cache-Control", "no-store");
    return response
      .status(200)
      .json(authorization.filterOutput(actor, "read:user:admin", updated));
  }

  if (body.action === "change_email") {
    const mode = body.mode === "immediate" ? "immediate" : "verify";

    if (mode === "immediate") {
      const updated = await emailChange.applyImmediateChange({
        targetUser,
        newEmail: body.email,
      });

      await auditLog.record({
        action: "admin.user_email_changed",
        actorUserId: actor.id,
        targetUserId: targetUser.id,
        ip,
        metadata: {
          mode: "immediate",
          new_email: updated.email,
        },
      });

      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json({
        mode: "immediate",
        user: authorization.filterOutput(actor, "read:user:admin", updated),
      });
    }

    const token = await emailChange.requestChange({
      targetUser,
      newEmail: body.email,
      requestedByUserId: actor.id,
    });

    await auditLog.record({
      action: "admin.user_email_change_requested",
      actorUserId: actor.id,
      targetUserId: targetUser.id,
      ip,
      metadata: {
        mode: "verify",
        token_id: token.id,
        new_email: token.new_email,
      },
    });

    response.setHeader("Cache-Control", "no-store");
    return response.status(202).json({
      mode: "verify",
      pending_email_change: {
        id: token.id,
        new_email: token.new_email,
        expires_at: token.expires_at,
      },
    });
  }

  if (body.action === "grant_admin" || body.action === "revoke_admin") {
    if (!authorization.can(actor, "manage:admins")) {
      throw new ForbiddenError({
        message: "Você não possui permissão para alterar privilégios.",
        action: 'É necessário possuir a feature "manage:admins".',
      });
    }

    if (body.action === "grant_admin") {
      if (targetUser.features?.includes("read:activation_token")) {
        throw new ValidationError({
          message: "Esta conta ainda não confirmou o e-mail.",
          action:
            "Aguarde a pessoa confirmar o cadastro antes de torná-la administradora.",
        });
      }

      const nextFeatures = [
        ...new Set([...(targetUser.features || []), ...ALL_ADMIN_FEATURES]),
      ];
      const updated = await user.updateFeaturesByAdmin(
        targetUser.id,
        nextFeatures,
      );

      await auditLog.record({
        action: "admin.user_promoted",
        actorUserId: actor.id,
        targetUserId: targetUser.id,
        ip,
        metadata: {
          previously_admin: authorization.can(targetUser, "admin"),
        },
      });

      response.setHeader("Cache-Control", "no-store");
      return response
        .status(200)
        .json(authorization.filterOutput(actor, "read:user:admin", updated));
    }

    if (targetUser.id === actor.id) {
      throw new ValidationError({
        message: "Você não pode remover o próprio acesso administrativo.",
        action: "Peça a outro administrador se precisar alterar seu acesso.",
      });
    }

    const baseFeatures = (targetUser.features || []).filter(
      (feature) => !ADMIN_PANEL_FEATURES.includes(feature),
    );
    const nextFeatures = [...new Set([...ACTIVATED_FEATURES, ...baseFeatures])];
    const updated = await user.updateFeaturesByAdmin(
      targetUser.id,
      nextFeatures,
    );

    await auditLog.record({
      action: "admin.user_demoted",
      actorUserId: actor.id,
      targetUserId: targetUser.id,
      ip,
    });

    response.setHeader("Cache-Control", "no-store");
    return response
      .status(200)
      .json(authorization.filterOutput(actor, "read:user:admin", updated));
  }

  if (body.action === "update_features") {
    if (!authorization.can(actor, "manage:admins")) {
      throw new ForbiddenError({
        message: "Você não possui permissão para alterar privilégios.",
        action: 'É necessário possuir a feature "manage:admins".',
      });
    }

    const nextFeatures = Array.isArray(body.features) ? body.features : [];
    if (
      targetUser.id === actor.id &&
      (!nextFeatures.includes("admin") ||
        !nextFeatures.includes("manage:admins"))
    ) {
      throw new ValidationError({
        message:
          "Você não pode remover suas próprias permissões administrativas.",
        action: "Peça a outro administrador se precisar alterar seu acesso.",
      });
    }

    const updated = await user.updateFeaturesByAdmin(
      targetUser.id,
      nextFeatures,
    );

    await auditLog.record({
      action: "admin.user_features_updated",
      actorUserId: actor.id,
      targetUserId: targetUser.id,
      ip,
      metadata: { features: updated.features },
    });

    response.setHeader("Cache-Control", "no-store");
    return response
      .status(200)
      .json(authorization.filterOutput(actor, "read:user:admin", updated));
  }

  throw new ValidationError({
    message: `A ação "${body.action}" não existe.`,
    action:
      'Use "change_username", "change_email", "grant_admin", "revoke_admin" ou "update_features".',
  });
}

async function deleteHandler(request, response) {
  const actor = request.context.user;
  const targetId = request.query.id;

  if (!user.UUID_PATTERN.test(String(targetId))) {
    await user.findAdminDetailById(targetId);
  }

  const targetUser = await user.findOneById(targetId);
  if (targetUser.id === actor.id) {
    throw new ValidationError({
      message: "Você não pode excluir a própria conta pelo painel.",
      action: "Outro administrador pode realizar a remoção, se necessário.",
    });
  }

  const erased = await user.erase(targetUser.id);

  await auditLog.record({
    action: "admin.user_erased",
    actorUserId: actor.id,
    targetUserId: targetUser.id,
    ip: controller.getClientIp(request),
    metadata: {
      had_admin: authorization.can(targetUser, "admin"),
    },
  });

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(erased);
}
