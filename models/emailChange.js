import database from "infra/database.js";
import email from "infra/email.js";
import webserver from "infra/webserver.js";
import user from "models/user.js";
import { NotFoundError, ValidationError } from "infra/errors.js";

// Troca de e-mail com confirmação por link enviado ao novo endereço.
//
// Usada tanto na operação administrativa quanto no fluxo futuro de recuperação
// sem acesso ao e-mail (cláusula 1.4): garante que a nova caixa existe e evita
// que um erro de digitação tranque o usuário fora da conta.
const EXPIRATION_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function tokenNotFoundError() {
  return new NotFoundError({
    message:
      "O link de confirmação de e-mail não foi encontrado, já foi usado ou expirou.",
    action: "Solicite uma nova alteração de e-mail.",
  });
}

async function prepareTargetForEmailChange(targetUser, rawNewEmail) {
  if (!targetUser || targetUser.deleted_at) {
    throw new ValidationError({
      message: "Não é possível alterar o e-mail de uma conta excluída.",
      action: "Selecione uma conta ativa.",
    });
  }

  const normalized = user.normalizeAndValidateEmail(rawNewEmail);

  if (
    targetUser.email &&
    targetUser.email.toLowerCase() === normalized.toLowerCase()
  ) {
    throw new ValidationError({
      message: "O novo email é igual ao email atual da conta.",
      action: "Informe um endereço de email diferente.",
    });
  }

  await user.validateUniqueEmail(normalized, targetUser.id);
  return normalized;
}

async function requestChange({
  targetUser,
  newEmail,
  requestedByUserId = null,
}) {
  const normalized = await prepareTargetForEmailChange(targetUser, newEmail);
  const expiresAt = new Date(Date.now() + EXPIRATION_IN_MILLISECONDS);

  const created = await database.withTransaction(async (client) => {
    await client.query({
      text: `
        UPDATE
          user_email_change_tokens
        SET
          used_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          user_id = $1
          AND used_at IS NULL
      ;`,
      values: [targetUser.id],
    });

    const result = await client.query({
      text: `
        INSERT INTO
          user_email_change_tokens (user_id, new_email, requested_by, expires_at)
        VALUES
          ($1, $2, $3, $4)
        RETURNING
          *
      ;`,
      values: [targetUser.id, normalized, requestedByUserId, expiresAt],
    });

    return result.rows[0];
  });

  await email.send({
    from: "Menu Spoiler <contato@menuspoiler.com.br>",
    to: normalized,
    subject: "Confirme a alteração do seu e-mail no Menu Spoiler",
    text: `Olá! Recebemos um pedido para alterar o e-mail da sua conta no Menu Spoiler para este endereço.

Para confirmar a alteração, abra este link:

${webserver.origin}/conta/confirmar-email/${created.id}

O link vale por 24 horas e só pode ser usado uma vez.

Se você não reconhece este pedido, ignore esta mensagem: o e-mail atual da conta não foi alterado.

Atenciosamente,
Equipe Menu Spoiler`,
  });

  if (targetUser.email) {
    await sendOldAddressNotice(targetUser.email, normalized, false);
  }

  return created;
}

async function findOneValidById(tokenId) {
  if (typeof tokenId !== "string" || !user.UUID_PATTERN.test(tokenId)) {
    throw tokenNotFoundError();
  }

  const results = await database.query({
    text: `
      SELECT
        id,
        user_id,
        new_email,
        expires_at,
        used_at,
        created_at
      FROM
        user_email_change_tokens
      WHERE
        id = $1
        AND expires_at > NOW()
        AND used_at IS NULL
      LIMIT
        1
    ;`,
    values: [tokenId],
  });

  if (results.rowCount === 0) {
    throw tokenNotFoundError();
  }

  return results.rows[0];
}

async function confirmByTokenId(tokenId) {
  if (typeof tokenId !== "string" || !user.UUID_PATTERN.test(tokenId)) {
    throw tokenNotFoundError();
  }

  try {
    return await database.withTransaction(async (client) => {
      const tokenResult = await client.query({
        text: `
          SELECT
            *
          FROM
            user_email_change_tokens
          WHERE
            id = $1
            AND expires_at > NOW()
            AND used_at IS NULL
          FOR UPDATE
        ;`,
        values: [tokenId],
      });

      if (tokenResult.rowCount === 0) {
        throw tokenNotFoundError();
      }

      const token = tokenResult.rows[0];

      const updatedUserResult = await client.query({
        text: `
          UPDATE
            users
          SET
            email = $2,
            updated_at = timezone('utc', now())
          WHERE
            id = $1
            AND deleted_at IS NULL
          RETURNING
            id, username, email, features, created_at, updated_at
        ;`,
        values: [token.user_id, token.new_email],
      });

      if (updatedUserResult.rowCount === 0) {
        throw tokenNotFoundError();
      }

      await client.query({
        text: `
          UPDATE
            user_email_change_tokens
          SET
            used_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
          WHERE
            user_id = $1
            AND used_at IS NULL
        ;`,
        values: [token.user_id],
      });

      // Invalida tokens antigos de recuperação para impedir uso na caixa antiga.
      await client.query({
        text: `
          UPDATE
            password_recovery_tokens
          SET
            used_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
          WHERE
            user_id = $1
            AND used_at IS NULL
        ;`,
        values: [token.user_id],
      });

      return {
        token,
        user: updatedUserResult.rows[0],
      };
    });
  } catch (error) {
    if (error.cause?.code === "23505") {
      throw new ValidationError({
        message: "O email informado já está sendo utilizado.",
        action: "Solicite uma nova troca com outro endereço de email.",
      });
    }
    throw error;
  }
}

async function applyImmediateChange({ targetUser, newEmail }) {
  const normalized = await prepareTargetForEmailChange(targetUser, newEmail);

  let updatedUser;
  try {
    updatedUser = await database.withTransaction(async (client) => {
      const updated = await client.query({
        text: `
          UPDATE
            users
          SET
            email = $2,
            updated_at = timezone('utc', now())
          WHERE
            id = $1
            AND deleted_at IS NULL
          RETURNING
            id, username, email, features, created_at, updated_at
        ;`,
        values: [targetUser.id, normalized],
      });

      if (updated.rowCount === 0) {
        throw new NotFoundError({
          message: "A conta informada não foi encontrada.",
          action: "Atualize a lista de usuários e tente de novo.",
        });
      }

      await client.query({
        text: `
          UPDATE
            user_email_change_tokens
          SET
            used_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
          WHERE
            user_id = $1
            AND used_at IS NULL
        ;`,
        values: [targetUser.id],
      });

      await client.query({
        text: `
          UPDATE
            password_recovery_tokens
          SET
            used_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
          WHERE
            user_id = $1
            AND used_at IS NULL
        ;`,
        values: [targetUser.id],
      });

      return updated.rows[0];
    });
  } catch (error) {
    if (error.cause?.code === "23505") {
      throw new ValidationError({
        message: "O email informado já está sendo utilizado.",
        action: "Utilize outro email para realizar esta operação.",
      });
    }
    throw error;
  }

  await email.send({
    from: "Menu Spoiler <contato@menuspoiler.com.br>",
    to: normalized,
    subject: "Seu e-mail no Menu Spoiler foi atualizado",
    text: `Olá! O e-mail vinculado à sua conta no Menu Spoiler foi atualizado para este endereço pela administração.

Se precisar redefinir sua senha, você já pode usar a opção "Esqueci a senha" com este e-mail.

Atenciosamente,
Equipe Menu Spoiler`,
  });

  if (targetUser.email) {
    await sendOldAddressNotice(targetUser.email, normalized, true);
  }

  return updatedUser;
}

async function sendOldAddressNotice(oldEmail, newEmail, appliedImmediately) {
  try {
    await email.send({
      from: "Menu Spoiler <contato@menuspoiler.com.br>",
      to: oldEmail,
      subject: appliedImmediately
        ? "Aviso: o e-mail da sua conta Menu Spoiler foi alterado"
        : "Pedido de alteração de e-mail na sua conta Menu Spoiler",
      text: appliedImmediately
        ? `Olá! Informamos que o e-mail da sua conta no Menu Spoiler foi alterado pela administração para ${newEmail}.

Se você não reconhece esta operação, entre em contato com contato@menuspoiler.com.br imediatamente.

Atenciosamente,
Equipe Menu Spoiler`
        : `Olá! Foi iniciada uma solicitação para alterar o e-mail da sua conta no Menu Spoiler para ${newEmail}, aguardando confirmação no novo endereço.

Se você não reconhece esta operação, entre em contato com contato@menuspoiler.com.br.

Atenciosamente,
Equipe Menu Spoiler`,
    });
  } catch (error) {
    // O endereço antigo pode não existir mais (caso típico da cláusula 1.4).
    console.error({
      name: "EmailChangeNoticeError",
      underlyingErrorName: error?.name,
    });
  }
}

const emailChange = {
  EXPIRATION_IN_MILLISECONDS,
  requestChange,
  findOneValidById,
  confirmByTokenId,
  applyImmediateChange,
};

export default emailChange;
