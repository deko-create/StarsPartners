# gt.bet product remediation contract

The QA repository cannot deploy the production changes below. This contract gives the edge,
frontend, sportsbook, and SEO owners exact implementation and acceptance criteria.

## WAF policy

The desktop run is dominated by Cloudflare challenges on authenticated, profile, payment, and
casino routes. In the `gt.bet` zone:

1. Create a managed `qa_egress_ips` list containing only static QA/CI egress addresses.
2. Add a custom rule before the managed challenge rule:

   ```text
   (http.host eq "gt.bet"
    and ip.src in $qa_egress_ips
    and http.request.method in {"GET" "HEAD"}
    and http.request.uri.path in {"/" "/assets/" "/casino/" "/livecasino/" "/sports/"})
   ```

3. Skip only the bot or managed-challenge checks blocking HTML documents. Keep DDoS protection,
   rate limits, credential-abuse checks, authorization, and payment API protections enabled.
4. If static egress is unavailable, validate a Cloudflare Access service token at the edge. Do
   not trust an arbitrary client-supplied bypass header.
5. Verify that an untrusted address remains challenged while the trusted QA identity receives
   the application document on every listed route.

The runner already supports `PW_EXTRA_HTTP_HEADERS_JSON` and the narrower
`PW_QA_BYPASS_HEADER_NAME`/`PW_QA_BYPASS_HEADER_VALUE` pair. Use them only after the edge validates
the corresponding QA identity.

## Registration exit confirmation

The Close action in the signup exit-confirmation layer must dismiss the confirmation and the
registration flow without immediately reopening either surface. The action needs an accessible
name, a stable component-owned selector, and must not share the mobile-sidebar toggle handler.

Acceptance: open signup, request exit, activate Close once, and observe that both signup layers are
hidden, focus returns to the original signup trigger, and the mobile sidebar remains closed.

## Language persistence

Store an explicitly selected locale in the canonical locale cookie/profile preference before the
route reload. Application bootstrap must read that value before applying the geo/default locale;
the default may be used only when no valid explicit preference exists.

Acceptance: select French (`fr`), reload the current route twice, and verify the locale trigger,
document language, translated navigation, cookie, and profile preference all remain French.

## Sports event return navigation

The event route opens, but neither a semantic Back control nor browser history returns to the
sports list. The sportsbook shell must do one of the following:

- render a keyboard-accessible Back button that restores the previous `bt-path`; or
- push the event route into browser history and handle `popstate` by restoring the list view.

Acceptance: open `Casa Pia Lisbon - SL Benfica`, activate Back, and return to the previous sports
list with a changed URL and the former scroll/list context restored.

## Sports metadata and H1

Render sports metadata in the first-party SSR document, outside the provider shadow root:

```html
<title>Sports Betting & Live Odds | GT</title>
<meta property="og:title" content="Sports Betting & Live Odds | GT" />
<link rel="canonical" href="https://gt.bet/sports/" />
<h1>Sports Betting & Live Odds</h1>
```

The H1 may be visually hidden but must remain accessible and server-rendered. Query-string
`bt-path` pages should retain `/sports/` as canonical unless SEO explicitly defines indexable
landing pages.

Acceptance: the sports root, football, and live views have a sports-specific title, one meaningful
H1, and the `/sports/` canonical.

## Invalid flag assets

Do not construct a flag URL when the country code is empty, `null`, or `undefined`. Normalize the
code first and render a local neutral fallback icon when it is not in the supported-code set.

Acceptance: sports browsing emits no request matching `flags_by_code/(undefined|null|).svg`, and
events without a country code render a stable fallback without console or ORB errors.

## Recent Games persistence

After an authenticated real-mode launch succeeds, persist the normalized game identity
(`provider`, `slug`, and immutable game id where available) to the player's recent-history source.
The `/recent/` response must use the same identity model as the launch endpoint and invalidate its
cached empty state after a successful launch.

Acceptance: launch `Gtbet Bonsai`, return to `/recent/`, and observe the same Novomatic game within
three refresh/poll intervals. The card must expose a stable provider/slug or game-id link so the
result can be matched without title-only heuristics.

## OpenAPI contract inputs

Expose versioned, access-controlled Auth and Payment OpenAPI documents to QA, or publish them as
CI artifacts. Configure their locations through `QA_AUTH_OPENAPI_URL` and
`QA_PAYMENT_OPENAPI_URL`; local files under `contracts/openapi/` are also supported.

Acceptance: Spectral and Schemathesis both execute for Auth and Payment instead of reporting a
missing integration input.
