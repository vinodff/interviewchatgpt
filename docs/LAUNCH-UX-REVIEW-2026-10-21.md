# InterviewPilot pricing and usability review — October 21, 2026

## Plan structure

The requested three-plan structure uses these configurable launch defaults:

| Plan | Monthly price | Live minutes per calendar month |
| --- | --- | --- |
| Free | ₹0 | 30 |
| Starter | ₹299 | 180 |
| Pro | ₹799 | 600 |

All tiers use the existing interview tools; paid tiers add time rather than unsupported features. Minutes do not roll over. Subscription renewal dates and calendar-month allowance resets are explained separately. No annual discounts, priority-support promises, hidden modes, or unimplemented practice features are advertised.

`backend/app/config.py` owns account pricing and allowances. `GET /api/billing/plans` publishes the sanitized catalog. The frontend reads that catalog server-side and uses a clearly marked launch preview with disabled payment actions if it cannot obtain current account data. Browser-only and local preview access cannot buy subscriptions.

Before offering payments, configure `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRICE_ID` (Pro), the Stripe key, and signed webhook secret. Stripe prices must be active INR monthly subscriptions matching the advertised paise amounts. Checkout verifies this before creating a customer or payment session. This change does not create Stripe products or enable real charges.

## Research and applied decisions

- [Nielsen Norman Group: usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) — use familiar task language, clear system status, and recoverable errors. Primary actions now say “Start live interview”; navigation uses “Resume & projects”, “Past interviews”, and “My profile”.
- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — keep core choices visible and put less-used settings behind obvious controls. Audio engines, optional interview naming, fonts, themes, tone, sources, and reading speed remain available without dominating setup.
- [GOV.UK Design System: error messages](https://design-system.service.gov.uk/components/error-message/) — explain the problem and next action in plain language. Customer-facing messages do not ask visitors to configure backend services or add API keys. Consent and device limitations remain visible where relevant.
- [Stripe Price object](https://docs.stripe.com/api/prices/object) — validate amount, currency, active status, and recurring interval against the chosen plan. A billing return query never grants a paid entitlement; signed webhook updates remain authoritative.
- [Final Round AI](https://www.finalroundai.com/) was checked as a category reference. Its `/pricing` link redirected to the home page during this review; no competitor price was treated as a verified benchmark or copied into these launch defaults.

## Flow and bug corrections

- Public calls to action open `/interview?view=live`, preserving the need to sign in, confirm consent, and grant microphone permission. Merely opening setup does not capture audio.
- Legacy `/workspace`, password-reset links, and old payment-return links preserve their parameters and redirect to the interview screens.
- Internal navigation updates browser history; Back and reload retain the selected screen and paid-plan choice.
- Unknown or unavailable AI readiness leaves Start disabled. Advanced preferences are collapsed and autosave only valid reading speeds.
- Keyboard activation of role/company suggestions now selects the option. Uncontrolled text-size controls update their displayed value before the profile is saved.
- The 320px billing header no longer pushes the profile button off-screen.
- Starter has its own enforced allowance and signed subscription recognition. Checkout does not infer Pro from a browser query.
- Changing plans expires obsolete pending checkouts. Idempotency attempts survive uncertain retries and change after intentional expiration, including Starter → Pro → Starter.
- Existing subscribers can request subscription management even when the public catalog cannot load or new-purchase price IDs are unavailable.
- The contact form carries a chosen plan into the message, uses explicit textarea labeling, and prepares an email for the visitor to review and send.

## Validation boundaries

The frontend unit suite, backend suite, public-page browser checks, and mocked account/interview journeys exercise the changes without real payments or provider calls. UI checks cover 320px through desktop, keyboard controls, no-JavaScript content, and reduced motion. Separate audio/provider journeys still require the configured services and fixtures.

The existing local backend environment could not query its Python interpreter. Backend tests were therefore run in a separate temporary environment using the locked dependencies and an isolated SQLite test database; the user's application database was not used for tests. Automatic approval review rejected launching the local interview service with “blocked by policy”, so actual local live audio remains unverified.
