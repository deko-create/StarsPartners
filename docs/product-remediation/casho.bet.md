# Casho.bet product remediation

Evidence source: desktop run `run-2026-11-16t08-49-46-042z-jxofoc`.

## Sports metadata

Apply route-specific metadata to `/sports/`, `/sports/football-1/`, and `/sports/live/`:

- replace the generic VIP document title with a title containing the relevant sports context;
- render one visible, non-empty `h1` describing the current sports page;
- keep the existing route-specific canonical URL, which is already correct.

Acceptance criteria: title, visible H1, and canonical are present and route-appropriate on all three routes after direct navigation and client-side navigation.

## Locale persistence

The language selector exposes Italiano (`it`) but selection is overwritten by English:

- the trigger remains `English` immediately after selection;
- `locale` and `brand_i18n_redirected` remain `en`;
- reload restores English.

Acceptance criteria: selecting Italiano updates the visible label, writes `it` to the locale state/cookie, and survives reload.

## Live Chat

The brand loads Gist resources, but the guest Live Chat action did not expose a usable widget in the recorded run. Verify that the sidebar action opens the Gist widget and that the iframe or embedded chat surface remains available long enough for pre-chat interaction.

## Registration modal exit

Verify that the confirmation action for abandoning Sign Up dismisses both the confirmation layer and the underlying registration modal.
