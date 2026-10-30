# The 50th PSP

Goal: a junior engineer adds a PSP in a day, and the worst a mistake that day can do is reject callbacks, never move money wrongly. So the money logic stays in one place, and each PSP is a thin translator in front of it. `handleCallback` is already that core (locks, state machine, credit once, hold mismatches). It needs two additions: a currency check against the deposit, and `ignore` events stopping before it.

```
POST /psp/:pspId/callbacks
  registry.get(pspId)       unknown id -> 404
  adapter.verify(raw)       bad signature -> 401, logged (size-capped), nothing stored
  adapter.parse(raw)        -> PspEvent: major units, our status words; ignore -> 200
  one DB transaction:
    insert psp_events (unique pspId + eventId)   duplicate -> 200
    handleCallback(event)                        today's core
```

The event insert and the core share a transaction. If they did not, a core failure after the insert would make the PSP's retry look like a duplicate, and the deposit would never be credited.

## Interface

```ts
interface PspAdapter {
  verify(raw: RawCallback, secret: string): void; // throws on a bad signature
  parse(raw: RawCallback): PspEvent;              // throws on anything it does not understand
}

type PspEvent = {
  eventId: string; // the PSP's delivery id, or a hash of the body
  pspRef: string;
  status: 'completed' | 'failed' | 'ignore';
  amount: string;  // major units
  currency: string;
};
```

Adapters are pure functions of the request, with no database and no network. That is what makes them safe to hand to a junior and easy to test.

## Verification and normalization

Both live in the adapter and nowhere else; the core trusts a `PspEvent` and nothing more. Signature schemes (HMAC, RSA, IP allowlist) are shared helpers, and an adapter only names its scheme and header. Minor units are converted with the currency's exponent from a table, never a hard-coded 100: JPY has 0 decimals and KWD has 3. Each PSP's status words map onto ours, and anything non-terminal (`pending`, `authorized`) becomes `ignore`. A `success` that arrives before `pending` is then harmless: the late `pending` is dropped, and the state machine would refuse it anyway. Unknown fields or values throw, and we answer 400 rather than guess.

## Config

Most PSPs are a JSON body, a signature header and a status map. A generic adapter reads these from config, so adding one is a config entry plus fixtures, with no new code:

```yaml
- id: fastpay_my
  adapter: generic-json
  signature: { scheme: hmac-sha256, header: X-Signature, secretRef: FASTPAY_MY_SECRET }
  fields: { eventId: id, pspRef: merchant_ref, status: state, amount: amount, currency: ccy }
  amountUnits: minor
  statusMap: { SUCCESS: completed, FAILED: failed, EXPIRED: failed, PENDING: ignore }
  enabled: false
```

An odd PSP gets a hand-written adapter behind the same interface. Secrets are referenced by name, never stored in config.

## Testing without the provider

Each PSP has recorded fixtures from its sandbox or docs (success, failure, pending, duplicate, bad signature), each paired with the `PspEvent` it must parse to. A shared conformance suite runs every adapter against its fixtures and against rules that hold for all of them: a bad signature throws, an unknown status throws, an amount comes out in major units, and the same body gives the same `eventId`. CI requires it to pass. The core is tested once, with `PspEvent`s, so races and mismatches are not re-tested per PSP. Real sandbox calls run nightly, outside CI, so a flaky provider cannot block a merge.

## The one-day checklist

1. Save the PSP's sample payloads as fixtures.
2. Write the config entry, or an adapter if the generic one cannot express it.
3. Run the conformance suite until it passes.
4. Open a PR. The payments owner reviews the status map and the amount units, the two places a mistake costs money.
5. Enable in staging, then production.
