# Decisions

Part A is done: deposits, PSP callbacks, wagers and withdrawals with the turnover lock, plus 44 tests. Part B is in `DESIGN-PSP.md`.

`npm test` migrates the test database and runs everything.

## Locking

Every operation that moves money runs in one transaction and takes row locks before it reads anything it will decide on.

- **Callbacks** lock the deposit row (`SELECT ... FOR UPDATE` by `pspRef`) and then the wallet row. A duplicate callback arriving at the same moment waits on the deposit lock. When it gets the row it sees `Completed` and returns 200 without doing anything.
- **Wagers and withdrawals** lock the wallet row first. Only then does a wager check the balance, and a withdrawal check turnover and then the balance. Two wagers at once run one after the other, so the second sees the balance the first left.
- **Lock order**: callbacks lock the funding tx, then the wallet. Wagers and withdrawals lock only the wallet; a withdrawal inserts a new funding tx but never locks an existing one. So there is no cycle and no deadlock.

I considered conditional updates (`UPDATE ... WHERE status = 'Pending'`, `UPDATE wallets SET balance = balance - x WHERE balance >= x`). They are shorter, but every flow here also has to write the ledger and the turnover counters from the same consistent read. One pattern everywhere (lock, read, decide, write) is easier to check.

The database backs up the service code, in case some future path forgets a check:

- `wallets.balance >= 0`, and the turnover counters cannot go negative.
- `wallet_txs.funding_tx_id` is unique, so one funding tx can post to the ledger at most once. In a test with the lock removed, this index turned 76 of 100 racing calls into errors and still allowed zero double credits.
- `wallet_txs` is append-only: a trigger rejects UPDATE and DELETE.
- Ledger sign is tied to type: deposits are positive, wagers and withdrawals negative. Deposits and withdrawals must link a funding tx; wagers must not.
- A trigger rejects any status change once a funding tx is `Completed` or `Failed`.

## Schema

- `funding_txs` holds deposits and withdrawals: type, status (`Pending`, `Completed`, `Failed`), amount, and for deposits `psp_ref` (unique) and `turnover_multiplier`. `received_amount` keeps the amount from a `completed` callback, and `review_reason` says why a deposit is held.
- `wallet_txs` is the ledger. One row per balance change, with a signed amount and `balance_after`. `SUM(amount)` per wallet equals `wallets.balance`, and the money tests check exactly that, along with the last `balance_after`.
- Wagers are only ledger rows (type `wager`). They have no lifecycle of their own here, so a separate table would just duplicate the ledger.
- `turnover_required` and `turnover_accrued` live on `wallets` and change under the same wallet lock as the balance. The other option was to `SUM` deposits and wagers at withdrawal time. That keeps one source of truth, but makes every withdrawal scan history and makes the locking harder to get right. Both numbers can still be rebuilt from `funding_txs` and `wallet_txs` if they are ever doubted.
- Money is `DECIMAL(36,18)` end to end: strings at the edges, BigNumber in between, written back with 18 places so money in every response has the same format as `GET /members/:id/wallet`.

## Callbacks

| Situation | What happens |
|---|---|
| `completed`, amount matches | Credit `deposit.amount`, add `amount x multiplier` to required turnover, write the ledger, mark `Completed`. 200. |
| Same callback again (sequential or concurrent) | No change, 200 with the current status. |
| `completed` again after `Completed`, different amount | No change, 200, logged. |
| `failed` | Mark `Failed`, no money. 200. |
| `failed` after `Completed`, or `completed` after `Failed` | 409 `invalid_transition`; nothing changes. |
| Unknown `pspRef` | 404, nothing written, logged. |
| `completed` with a different amount | Not credited. The deposit stays `Pending`, with `received_amount` stored and `review_reason = amount_mismatch`. 200, and logged. |
| Any callback on a deposit held for review | Ignored (200, no change), logged. |

**The amount mismatch** was a judgement call. Crediting what the PSP reports reflects money that may truly have arrived. But it also means a bug or a forged callback moves real money with nobody looking. Marking the deposit `Failed` is wrong too, since the money may be sitting at the PSP and `Failed` is terminal. So no money moves, and a human decides. I return 200 rather than 409 because PSPs retry on non-2xx, and this callback will never succeed on retry. I kept the brief's three statuses and used `review_reason` for the hold, instead of adding a fourth status.

**Unknown `pspRef`** gets a 404. A 200 would stop the retries, but it would also hide a real integration problem from the PSP side.

## Assumptions

- A withdrawal does not reset turnover. Both counters are lifetime totals, so after an unlock a new deposit with multiplier > 0 locks withdrawals again until it is covered. There is a test for this.
- `turnoverMultiplier: 0` adds no requirement.
- Only completed deposits count towards required turnover. Pending and held deposits do not.
- Wagers only debit. Winnings and settlement are outside this exercise.
- Turnover is checked before balance, so a member who is locked hears about the lock first.
- Amounts have at most 18 digits on each side of the point. A deposit is rejected if its own `amount x multiplier` would not fit the column, because the callback could otherwise never complete. This is per deposit; see known limits.

## Tests

- The four required ones: a sequential duplicate callback, concurrent duplicates (10 at once, 5 rounds), concurrent wagers (10 x 30 against 100: exactly 3 succeed, 5 rounds), and the turnover lock blocking and then unblocking at exact equality.
- Also covered: concurrent withdrawals (same shape as wagers, 5 rounds), completed and failed racing each other (5 rounds), a callback racing 5 wagers on the same wallet (1 round), re-lock after unlock, held deposits, invalid input, and direct tests that the database guards say no.
- Each concurrency test was checked against broken code. I removed the lock, saw the test fail, and put the lock back. The first version of the duplicate-callback test passed even without the lock. `request(app)` starts a new server per call, so the ten requests never actually overlapped. The concurrency tests now share one listening server.
- The suite passed three times in a row on a fresh database.

## Known limits and next steps

- Callbacks on a held deposit are logged but not stored. Next I would add a `psp_events` table (raw payload, received time, outcome) as the audit trail and reconciliation input. Part B builds on it.
- No endpoint to resolve a held deposit or approve a withdrawal. Both are human flows the brief left out.
- The append-only trigger does not block TRUNCATE, because the starter's tests clean up with TRUNCATE. In production I would revoke TRUNCATE and DELETE from the application role.
- No callback signature check. The brief's mock PSP has none; Part B covers it.
- Requests are not idempotent on the client side. A retried `POST /wagers` places a second wager. An `Idempotency-Key` header would fix that.
- The overflow check is per deposit. Many large deposits could still push `turnover_required` past the column; checking the running total inside the callback would close it.

## Time

About 2 h 52 min from setting up the environment to submitting, plus about 40 minutes of planning before that. Most of the code was written by Claude (see below), so this is not how long the same work would take me by hand.

## AI use

I used Claude (Anthropic) through Claude Code for most of the hands-on work, and I want to be clear about the split.

- **Decided by me:** the five design calls above. Row locks versus conditional updates, the wallet lock plus a DB check, turnover counters on the wallet, holding mismatched amounts for review with a 200, and 404 for unknown references. For each one, Claude laid out the options with the strongest case for each, and I chose. I also set the working rules: tests run only in a container, every claim needs evidence, and a concurrency test only counts once it has been seen to fail on broken code.
- **Written by Claude:** the migrations, services, routes and tests, and first drafts of this file and `DESIGN-PSP.md`.
- **Reviewed by AI:** after each step, a separate Claude instance with no shared context tried to break the work. Those reviews found the NULL `funding_tx_id` loophole, the 19-digit amount overflow, the unbounded multiplier, and missing race tests. All are fixed above.
- **Checked by running it:** every guard and concurrency claim here was run against the code. Nothing above is untested reasoning, except the items listed under known limits.
- **Reviewed by me:** before submitting, I went through each part with Claude: the schema, callbacks, wagers and withdrawals, the tests, and both documents.
