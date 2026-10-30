# Decisions

Part A is done: deposits, PSP callbacks, wagers and withdrawals with the turnover lock, plus `Idempotency-Key` support and 63 tests. Part B is in `DESIGN-PSP.md`.

Setup is the same as in `README.md` (`npm install`, `npm run db:up`, `npm test`). There are no new dependencies.

## Locking

Every operation that moves money runs in one transaction and takes row locks before it reads anything it will decide on.

A callback locks the deposit row (`FOR UPDATE`, found by `pspRef`) and then the wallet. A duplicate that arrives at the same moment waits on the deposit lock, then sees `Completed` and returns 200 without doing anything. A wager or a withdrawal locks the wallet first, and only then checks the balance (and, for a withdrawal, turnover). Two wagers at once run one after the other, so the second sees the balance the first left.

Wallet locks are `FOR NO KEY UPDATE`, not `FOR UPDATE`. Both serialise writers on the same wallet. `FOR UPDATE` also blocks the key-share lock that a new `funding_txs` row takes on its wallet, so opening a deposit would wait behind any wager. I checked both modes against Postgres: with `FOR UPDATE` held, a deposit insert hit a 1 s lock timeout; with `FOR NO KEY UPDATE` it went straight in.

Lock order is the funding tx, then the wallet. Wagers and withdrawals never lock an existing funding tx (a withdrawal only inserts a new one), so there is no cycle.

I considered conditional updates (`UPDATE ... WHERE status = 'Pending'`, `UPDATE wallets SET balance = balance - x WHERE balance >= x`). They are shorter, but every flow also writes the ledger and the turnover counters from the same read. One pattern everywhere (lock, read, decide, write) is easier to check.

The database backs this up in case a future code path forgets a check. Balances and turnover counters cannot go negative. `wallet_txs.funding_tx_id` is unique, so a funding tx can post to the ledger at most once; with the lock removed in a test, this index turned 76 of 100 racing calls into errors and still let through zero double credits. The ledger is append-only (a trigger rejects UPDATE and DELETE), its sign must match its type, and deposits and withdrawals must link a funding tx while wagers must not. Another trigger rejects any status change once a funding tx is `Completed` or `Failed`.

## Schema

`funding_txs` holds deposits and withdrawals: type, status (`Pending`, `Completed`, `Failed`), amount, and for deposits `psp_ref` (unique) and `turnover_multiplier`. `received_amount` keeps the amount from a `completed` callback, and `review_reason` says why a deposit is held.

`wallet_txs` is the ledger: one row per balance change, with a signed amount, `balance_after` and a `seq` taken at insert. `created_at` can tie at millisecond resolution, so history is ordered by `seq`. `SUM(amount)` per wallet equals `wallets.balance`, and the money tests check that and the last `balance_after`. Wagers are only ledger rows; they have no lifecycle of their own here, so a separate table would duplicate the ledger.

`turnover_required` and `turnover_accrued` live on `wallets` and change under the same lock as the balance. The other option was to sum deposits and wagers at withdrawal time: one source of truth, but every withdrawal scans history and the locking is harder to get right. Turnover changes are not ledger rows themselves. Both numbers can be rebuilt by replaying completed deposits and wager entries in `seq` order with the surplus cap below applied; the dropped surplus is not recorded separately, which an audit table would fix.

Money is `DECIMAL(36,18)` end to end: strings at the edges, BigNumber in between, written back with 18 places so every money field matches `GET /members/:id/wallet`.

## Callbacks

| Situation | What happens |
|---|---|
| `completed`, amount matches | Credit `deposit.amount`, add `amount x multiplier` to required turnover, write the ledger, mark `Completed`. 200. |
| Same callback again, sequential or concurrent | No change. 200 with the current status. |
| `completed` again after `Completed`, different amount | No change. 200, logged. |
| `failed` | Mark `Failed`, no money. 200. |
| `failed` after `Completed`, or `completed` after `Failed` | 409 `invalid_transition`, nothing changes. |
| Unknown `pspRef` | 404, nothing written, logged. |
| `completed` with a different amount | Not credited. Stays `Pending` with `received_amount` and `review_reason = amount_mismatch`. 200, logged. |
| Any callback on a held deposit | Ignored. 200, logged. |

The rule behind the status codes: 200 when we have recorded the outcome and the follow-up is ours; an error when the PSP side has something to look at. A mismatch is ours to review, and a retry can never change it, so retries would only be noise. An unknown reference or a reversal after a final status points at a problem in the PSP integration, so they get 404 and 409, and the retries keep it visible on their side.

The mismatch itself was a judgement call. Crediting what the PSP reports reflects money that may really have arrived, but a bug or a forged callback would then move real money with nobody looking. `Failed` is wrong too: the money may be sitting at the PSP, and `Failed` is terminal. So no money moves and a person decides. I kept the brief's three statuses and used `review_reason` for the hold instead of a fourth one.

## Client retries

`POST /deposits`, `/wallets/:id/wagers` and `/withdrawals` accept an optional `Idempotency-Key` header. Inside the same transaction as the operation, the key is inserted first into `idempotency_keys`, unique per scope (`wager:<walletId>`, `withdrawal:<memberId>`, `deposit:<memberId>`). The response is stored next to it. A retry with the same key gets the stored response back and moves nothing. A concurrent retry blocks on the unique index until the first commits, then reads the committed response; this relies on READ COMMITTED, which the transaction now sets explicitly. The same key with a different request (amounts compared after normalising, so `30` equals `30.0`) gets 422 `idempotency_key_reused`. A failed attempt rolls back with its key, so it can be retried later. Keys are kept forever here; in production they would expire after a day or so. Without the header, requests behave as before.

## Assumptions

- Turnover from before a deposit does not count towards it. When a deposit's callback completes, any surplus (accrued above required) is dropped before its own requirement is added. A shortfall carries over unchanged. Otherwise a member who over-wagered once could deposit and withdraw at once ever after. A withdrawal itself does not reset the counters.
- `turnoverMultiplier: 0` adds no requirement. Only completed deposits count; pending and held ones do not.
- Wagers only debit. Winnings and settlement are outside this exercise.
- A withdrawal checks turnover before balance, so a locked member hears about the lock first.
- Amounts have at most 18 digits each side of the point, with no signs, exponents or separators. A deposit is rejected if its own `amount x multiplier` would not fit the column, because its callback could then never complete.
- A callback must carry a positive amount, `failed` included, because the brief's callback shape always has one.

Each of these has a test.

## Tests

The four the brief asks for: a sequential duplicate callback, concurrent duplicates (10 at once, 5 rounds), concurrent wagers (10 x 30 against 100, exactly 3 succeed, 5 rounds), and the turnover lock blocking and then unblocking at exact equality. Also: concurrent withdrawals, completed and failed racing (5 rounds), a callback racing 5 wagers on one wallet, re-lock after unlock, the turnover surplus and shortfall rules, retries with an idempotency key (sequential, 10 at once for 5 rounds, reused key, failed then retried), held deposits, bad input (including non-numeric amounts and malformed JSON), and direct tests that the database guards say no.

Each concurrency test was checked against broken code: I removed the lock (or bypassed the idempotency check), saw the test fail, and put it back. The first version of the duplicate-callback test passed even without the lock. `request(app)` starts a new server per call, so the ten requests never overlapped. The concurrency tests now share one listening server.

## Known limits and next steps

- Callbacks on a held deposit are logged, not stored. Next would be a `psp_events` table (raw payload, received time, outcome) as the audit trail and reconciliation input. Part B builds on it.
- Nothing resolves a held deposit, approves a withdrawal, or refunds a rejected one (the ledger has no reversal type yet). These are human flows the brief left out.
- TRUNCATE is not blocked on the ledger, because the starter's tests clean up with it. In production the application role would not have TRUNCATE or DELETE.
- No callback signature check; the brief's mock PSP has none. Part B covers it.
- The overflow check is per deposit. Many large deposits could still push `turnover_required` past the column; checking the running total inside the callback would close that.

I also fixed two starter issues I hit while testing by hand: a malformed member id on `GET /members/:id/wallet` and a malformed JSON body both returned 500, and now return 400.

## Time and history

About 3 h 37 min from setting up the environment to submitting, plus about 40 minutes of planning before that. That includes a full review pass at the end, which found and fixed the issues listed in the commits after `Add DECISIONS.md`, and adding idempotency keys after that review named client retries as the main money risk left. This runs past the 4 hour budget; I chose to close that gap rather than leave it as a note. Most of the code was written by Claude (see below), so this is not how long the same work would take me by hand.

About the commit history: the first nine commits were split from my working tree after the code was done, in the order the work happened, so their timestamps sit within a couple of minutes. Each of them builds and passes its own tests on a fresh database. The commits after that were made as each fix was done. They are minutes apart because Claude made the changes and I checked each batch before it was committed. No dates were changed.

## AI use

I used Claude (Anthropic) through Claude Code for most of the hands-on work.

- **Decided by me:** the design calls above: row locks over conditional updates, the wallet lock plus database checks, turnover counters on the wallet, holding mismatched amounts with a 200, and 404 for unknown references. For each, Claude laid out the options and the best case for each, and I chose. I also set the working rules: run only in a container, back every claim with evidence, and only trust a concurrency test after seeing it fail on broken code.
- **Written by Claude:** the migrations, services, routes and tests, and first drafts of this file and `DESIGN-PSP.md`.
- **Reviewed by AI:** after each step, a separate Claude instance with no shared context tried to break the work. Those reviews found the NULL `funding_tx_id` loophole, the amount overflows, the 500 on non-numeric amounts, the ledger ordering, the turnover surplus, and missing race tests. All are fixed.
- **Reviewed by me:** before submitting, I went through each part with Claude: the schema, callbacks, wagers and withdrawals, the tests, and both documents.
