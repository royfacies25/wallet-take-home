# The 50th PSP

Goal: a junior engineer adds a PSP in a day, and the worst a mistake in that day can do is reject callbacks. It should never be able to move money wrongly.

So the money logic stays in one place and each PSP is a thin translator in front of it. `handleCallback` already is that core: it locks, enforces the state machine, credits once and holds mismatches. It needs two small additions: `ignore` events stop before it, and it checks `currency` against the deposit (a column it does not have yet). PSP code never touches it.

```
POST /psp/:pspId/callbacks
        |
        v
  registry.get(pspId) ---- unknown id -> 404
        |
        v
  adapter.verify(raw)  ---- bad signature -> 401, stored, nothing else
        |
        v
  adapter.parse(raw) -> PspEvent      (normalized: major units, our status words)
        |
        v
  psp_events insert (unique pspId + eventId) -- duplicate -> 200
        |
        v
  handleCallback(event)    <- today's core: locks, state machine, ledger
```

## The interface

```ts
interface PspAdapter {
  id: string;
  verify(raw: RawCallback, secret: string): void; // throws on a bad signature
  parse(raw: RawCallback): PspEvent;              // throws on anything it does not understand
}

type PspEvent = {
  eventId: string;          // the PSP's own id for this delivery, or a hash of the body
  pspRef: string;           // our reference, echoed back
  status: 'completed' | 'failed' | 'ignore';
  amount: string;           // major units, decimal string
  currency: string;
};
```

Adapters are pure functions of the raw request: no database, no network. That makes them safe to hand to a junior and easy to test.

## Where verification and normalization live

Both live in the adapter, and nowhere else. The core trusts a `PspEvent` and nothing more.

- **Signatures**: HMAC, RSA or IP allowlist, each written once as a shared helper. An adapter only names its scheme and header.
- **Minor units**: `10050` becomes `"100.50"` using the currency's exponent from a table, never a hard-coded 100 (JPY has 0 decimals, KWD 3).
- **Status words**: each PSP's vocabulary maps onto ours. Anything not terminal (`pending`, `processing`, `authorized`) maps to `ignore`. That is how a `success` arriving before `pending` stays harmless: the late `pending` is dropped, and the state machine already refuses to move a `Completed` deposit anywhere.
- **Unknown fields or values** throw. We answer 400 and keep the raw payload, rather than guess.

## How config drives it

Most PSPs are a JSON body, a signature header and a status map. For those, a generic adapter reads its behaviour from config, so adding one is a config change plus test fixtures, with no new code:

```yaml
- id: fastpay_my
  adapter: generic-json
  signature: { scheme: hmac-sha256, header: X-Signature, secretRef: FASTPAY_MY_SECRET }
  fields: { eventId: id, pspRef: merchant_ref, status: state, amount: amount, currency: ccy }
  amountUnits: minor
  statusMap: { SUCCESS: completed, FAILED: failed, PENDING: ignore, EXPIRED: failed }
  enabled: false
```

An odd PSP gets a hand-written adapter behind the same interface. Secrets are referenced by name, never stored in config, and `enabled` switches a PSP on per environment.

## Testing without calling the provider

- **Recorded fixtures**: real bodies from the PSP's sandbox or docs (success, failure, pending, duplicate, bad signature) in `fixtures/<pspId>/`, each with the `PspEvent` it must parse to.
- **A shared conformance suite** runs every adapter against its fixtures and against rules that apply to all of them. A bad signature must throw. An unknown status must throw. An amount must come out as a decimal string in major units. The same body must give the same `eventId`. A new adapter is done when the suite passes, and CI enforces it.
- **The core is tested once**, with `PspEvent`s. Duplicates, races and mismatches are not re-tested per PSP.
- **Sandbox calls** run in a nightly job, never in CI, so a flaky provider cannot block a merge.

## The one-day checklist

1. Copy the fixture folder template and save the PSP's sample payloads into it.
2. Write the config entry (or the adapter, if the generic one cannot express it).
3. Run the conformance suite until it passes.
4. Open a PR. The payments owner reviews the status map and amount units, the two places a mistake costs money.
5. Enable in staging, then production.
