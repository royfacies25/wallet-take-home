import { createHash } from 'crypto';
import { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { HttpError } from '../lib/errors';

export type StoredResponse = { status: number; body: Record<string, unknown> };

type KeyRow = { id: string; request_hash: string; response_status: number; response_body: Record<string, unknown> };

// Runs `work` at most once per (scope, key) and replays its response to retries. Without a key it just runs.
export async function run(
  scope: string,
  key: string | undefined,
  request: unknown,
  work: (t: Transaction) => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!key) {
    return sequelize.transaction(work);
  }
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  // The conflict path relies on READ COMMITTED: after waiting, the next statement must see the row the first request committed.
  return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (t) => {
    // A second request with the same key blocks on this insert until the first commits, then takes the conflict path.
    const [inserted] = (await sequelize.query(
      `INSERT INTO idempotency_keys (scope, key, request_hash) VALUES (:scope, :key, :requestHash)
       ON CONFLICT (scope, key) DO NOTHING RETURNING id`,
      { replacements: { scope, key, requestHash }, transaction: t },
    )) as [KeyRow[], unknown];

    if (inserted.length === 0) {
      const [rows] = (await sequelize.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = :scope AND key = :key',
        { replacements: { scope, key }, transaction: t },
      )) as [KeyRow[], unknown];
      if (rows[0].request_hash !== requestHash) {
        throw new HttpError(422, 'idempotency_key_reused');
      }
      return { status: rows[0].response_status, body: rows[0].response_body };
    }

    const response = await work(t);
    await sequelize.query(
      'UPDATE idempotency_keys SET response_status = :status, response_body = CAST(:body AS jsonb) WHERE id = :id',
      { replacements: { status: response.status, body: JSON.stringify(response.body), id: inserted[0].id }, transaction: t },
    );
    return response;
  });
}
