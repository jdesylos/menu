import database from "infra/database.js";
import { RateLimitError } from "infra/errors.js";

async function check({ identifier, limit, windowMs }) {
  const cutoff = new Date(Date.now() - windowMs);

  const result = await database.query({
    text: `
      INSERT INTO
        rate_limits (identifier, count, window_started_at)
      VALUES
        ($1, 1, NOW())
      ON CONFLICT (identifier) DO UPDATE
      SET
        count = CASE
          WHEN rate_limits.window_started_at < $2
          THEN 1
          ELSE rate_limits.count + 1
        END,
        window_started_at = CASE
          WHEN rate_limits.window_started_at < $2
          THEN NOW()
          ELSE rate_limits.window_started_at
        END
      RETURNING
        count, window_started_at
    ;`,
    values: [identifier, cutoff],
  });

  const { count, window_started_at } = result.rows[0];

  if (count > limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((window_started_at.getTime() + windowMs - Date.now()) / 1000),
    );
    throw new RateLimitError({
      message: "Muitas tentativas. Aguarde antes de tentar novamente.",
      retryAfter,
    });
  }
}

const rateLimit = {
  check,
};

export default rateLimit;
