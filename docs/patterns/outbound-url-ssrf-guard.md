# Outbound URL SSRF guard

← [Pattern catalog](README.md) · Category: Security

## Problem

Web Push makes the **server** POST to a URL the **client** supplied (the subscription endpoint). The same is true of webhooks you let users configure, and of "fetch this image URL" features. Without validation, a user can point the server at `http://169.254.169.254/` or an internal service.

## When to use

Any time server code calls a URL that came from user input.

## Solution

Validate the URL when it is **stored**, with a strict allow-shape rather than a deny-list of bad IPs:

```ts
/** The server POSTs to `endpoint`, so it must be a public https URL — never an address inside our network. */
function assertPublicHttpsUrl(endpoint: string) {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) throw new InvalidPushSubscriptionError('Endpoint is too long')
  let url: URL
  try { url = new URL(endpoint) } catch { throw new InvalidPushSubscriptionError('Endpoint must be a valid URL') }
  const host = url.hostname
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(':')
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new InvalidPushSubscriptionError('Endpoint must be an https URL')
  if (isIpLiteral || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal'))
    throw new InvalidPushSubscriptionError('Endpoint must point to a public push service')
}
```

What each check rules out:
- a length cap on the endpoint;
- `https:` only, and no userinfo tricks;
- IPv4 or IPv6 literals;
- single-label hosts such as `localhost` or intranet names (no dot);
- mDNS and cloud-internal names (`.local`, `.internal`).

The keys are checked separately: base64url, at most 256 characters.

- Cap how many such URLs a user can store (10 subscriptions here, oldest dropped).
- Bind each one to an owner and a session, and delete it when the session ends.

## Edge cases and pitfalls

- **DNS can still resolve a public-looking name to a private IP** (DNS rebinding). For a general-purpose fetcher, also resolve and check the address at connect time, or send egress through a proxy that blocks private ranges. For Web Push, endpoints come from browser push services, and the shape check is the pragmatic level.
- **Redirects.** Do not follow them, or re-validate every hop.
- **Timeouts and response size limits** on the outbound call, so a slow endpoint cannot hold a worker.

## In this repo

- `modules/notification/src/domain/push-subscription.ts`
- `modules/notification/src/application/use-cases/push-subscriptions.ts` (the per-user cap)

## Reuse checklist

- [ ] https only, no userinfo, no IP literals, dotted public hostname, no internal suffixes
- [ ] Validated on write; per-owner cap
- [ ] Connect-time IP check or egress proxy for general fetchers
