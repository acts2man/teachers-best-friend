# Connecting Stripe

This is the one-time job of switching paid plans on. Everything in the app is
already built and deployed; it is waiting on five environment variables. No
code changes, no developer, no deploy beyond the one Netlify does for you when
you save the variables.

You will do the whole thing twice: once in **test mode**, where Stripe gives
you fake card numbers and nothing real is charged, and then again in **live
mode**. Do not skip the test run. It is the only way to find out that a price
id was pasted into the wrong box before a teacher does.

Set aside about an hour for the test run.

---

## What "on" and "off" mean

The app checks for five variables. If **all five** are present, paid plans
work. If **any one** is missing, billing is off: the plans still show on the
pricing page and in the app, the buttons read "Opening soon" and cannot be
clicked, and nothing breaks.

There is no half-on state, on purpose. A secret key with no webhook secret
would take a teacher's money and never hear that it worked — they would pay
and stay on the free plan.

So: fill in all five, or none.

---

## Part 1 — Test mode

### 1. Create the Stripe account

Go to <https://dashboard.stripe.com/register> and sign up. Use the business
email, not a personal one.

You will be asked for business details. You can skip most of it for now —
**test mode works before your account is fully activated.** You only need to
finish activation before Part 2.

### 2. Make sure you are in test mode

Top right of the Stripe dashboard there is a toggle that says **Test mode**.
Turn it **on**. Everything you do for the rest of Part 1 happens with it on.

Test mode and live mode are effectively two separate Stripes. They have
separate products, separate prices, separate keys, and separate webhook
endpoints. Nothing you create in one exists in the other. This is the single
most common thing to get confused about, and it is why the price ids live in
environment variables rather than in our database: switching between the two
is changing the variables, nothing else.

### 3. Create one product with three prices

**Products → Add product.**

- **Name:** `A Teacher's Best Friend`
- **Description:** optional.

Under **Pricing**:

- **Amount:** `19.99`, **Currency:** USD, **Billing period:** Monthly,
  **Recurring**.
- Save the product.

Now add the other two to the *same* product — do not create three products.
Open the product, then **Add another price**:

- `29.99` monthly recurring
- `39.99` monthly recurring

One product with three prices is what lets a teacher switch tiers in the
customer portal. Three separate products cannot be switched between.

When you are done the product page shows three prices:

| Price | This is |
|---|---|
| $19.99 / month | Tier 1 — 500 pages |
| $29.99 / month | Tier 2 — 1,000 pages |
| $39.99 / month | Tier 3 — 1,500 pages |

### 4. Copy the three price ids

On the product page, each price row has an id that starts with **`price_`** —
for example `price_1QRxyzABCdefGHIJ`. Click the three dots at the end of a
price row and choose **Copy price ID**, or click into the price and copy it
from the top.

**A price id is not the product id.** The product id starts with `prod_`. If
you paste a `prod_` id anywhere below, checkout will fail.

Write them down, clearly labelled, before you go any further:

```
19.99 -> price_...........   (Tier 1)
29.99 -> price_...........   (Tier 2)
39.99 -> price_...........   (Tier 3)
```

### 5. Copy the secret key

**Developers → API keys.** (In newer dashboards: the **Developers** link at
the bottom, then **API keys**.)

You want the **Secret key**, which starts with **`sk_test_`** in test mode.
Click **Reveal** and copy it.

Do not copy the Publishable key (`pk_test_`) — that is the public one and the
app does not use it.

> The secret key is a password to your Stripe account. Do not email it, do not
> put it in Slack, do not paste it into a document. It goes into Netlify and
> nowhere else.

### 6. Set the first four variables in Netlify

Go to the Netlify site → **Site configuration → Environment variables**, then
**Add a variable** for each of these. Scope them to **All scopes** /
**All deploy contexts**.

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the `sk_test_...` key from step 5 |
| `STRIPE_PRICE_TIER1` | the `price_...` for $19.99 |
| `STRIPE_PRICE_TIER2` | the `price_...` for $29.99 |
| `STRIPE_PRICE_TIER3` | the `price_...` for $39.99 |

Leave the fifth (`STRIPE_WEBHOOK_SECRET`) for the next step. Billing stays off
until it is there, which is what we want while the webhook is only half
set up.

### 7. Register the webhook endpoint

A webhook is how Stripe tells the app that a payment happened. Without it, a
teacher pays and the app never finds out.

**Developers → Webhooks → Add endpoint** (in newer dashboards: **Workbench →
Webhooks → Add destination**).

- **Endpoint URL:**

  ```
  https://teachersbestfriend.netlify.app/api/billing/webhook
  ```

  If the site is on a custom domain by the time you do this, use the custom
  domain instead. It must be the address a browser actually reaches.

- **Listen to:** Events on your account.

- **Select events** — exactly these six, no more:

  ```
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.paid
  invoice.payment_failed
  ```

  Use the search box; they are easier to find than to scroll to. Extra events
  are harmless — the app acknowledges and ignores anything it was not asked
  for — but these six are the ones it acts on, and missing one means a real
  change to a teacher's plan never arrives.

- **Add endpoint.**

### 8. Copy the signing secret

On the endpoint page you just created there is a **Signing secret**. Click
**Reveal**. It starts with **`whsec_`**.

This is how the app knows a webhook really came from Stripe and not from
someone who guessed the URL. Copy it and add the fifth variable in Netlify:

| Variable | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | the `whsec_...` signing secret |

Each endpoint has its own signing secret. The test-mode endpoint and the
live-mode endpoint have **different** ones.

### 9. Redeploy

Netlify does not pick up new environment variables until the site is built
again. **Deploys → Trigger deploy → Deploy site.** Wait for it to finish
(about two minutes).

### 10. Turn on the customer portal

**Settings → Billing → Customer portal** (or search "customer portal" in the
dashboard search bar).

Turn on:

- **Customers can cancel subscriptions.** Choose **at end of billing period**
  — a teacher who cancels has already paid for the month and should keep it.
- **Customers can switch plans.** Then add the three prices from step 3 to the
  list of prices they may switch between. If you skip this, a teacher cannot
  upgrade without cancelling and starting again.
- **Customers can update payment methods.** This is the one that matters when
  a card expires.

Save.

### 11. Run a test checkout

1. Sign in to the app with a test teacher account.
2. Go to **Plan and billing** in the left sidebar.
3. The buttons should now read **Choose Tier 1** and so on, not "Opening
   soon". *If they still say "Opening soon", one of the five variables is
   missing or the redeploy has not finished.*
4. Click **Choose Tier 1**. Stripe's checkout page opens.
5. Pay with the test card:

   ```
   Card number   4242 4242 4242 4242
   Expiry        any future date, e.g. 12/34
   CVC           any three digits, e.g. 123
   Postcode      any, e.g. 12345
   ```

6. You land back on the billing page.

**What should have happened:**

- The page says **Tier 1** as your plan.
- The scans line reads out of **500**, not 36.
- There is a renewal date about a month away.
- A **Manage billing** button has appeared.
- In Stripe: **Payments** shows a $19.99 payment, and the webhook endpoint
  page shows six-ish deliveries, all with a green 200.

Then test the portal: click **Manage billing**, switch to Tier 2, come back.
The plan and the quota should follow within a few seconds. (Stripe sends the
webhook immediately, but the app reads it on the next page load — refresh if
it looks stale.)

Finally, cancel from the portal and check the app puts you back on **Free**
with 36 pages.

---

## Part 2 — Live mode

Do this only once every step of Part 1 worked.

1. Finish **account activation** in Stripe: business details, bank account
   for payouts, and identity verification. Stripe will not let you take real
   money until this is done, and it can take a day or two to review.
2. Turn **Test mode off**.
3. **Repeat steps 3 through 10 exactly**, in live mode:
   - Create the product and three prices again. *They do not carry over.*
   - Copy the three new `price_` ids — **they are different ids**.
   - Copy the live secret key, which starts with `sk_live_`.
   - Create the webhook endpoint again, same URL, same six events.
   - Copy that endpoint's signing secret — **also different**.
   - Configure the customer portal again in live mode.
4. Replace all five variables in Netlify with the live values.
5. Redeploy.
6. **Tell the smoke check that billing is on.** See the next section — one
   setting, easy to forget, so do it here while you are thinking about it.
7. Do one real checkout with a real card — your own. Then refund it from
   Stripe (**Payments → the payment → Refund**) and cancel the subscription.
   It costs you nothing but the few minutes, and it is the only way to know
   the live path works before a teacher finds out for you.

---

## Telling the smoke check that billing is on

Every deploy to `main` runs a workflow that asks the live site a handful of
questions — is the sign-up page reachable, does the homepage say the right
number of pages, does the billing endpoint answer sensibly. It lives in
`.github/workflows/deployed-version.yml` and calls `scripts/smoke-live.mjs`.

One of those questions has two right answers, and which one is right depends
on whether Stripe is connected:

| Site state | `POST /api/billing/webhook` with a junk body answers |
|---|---|
| Stripe **not** connected | **503** — billing is off, refused before the body is read |
| Stripe connected | **400** — the body carries no valid Stripe signature |

Both are correct. Neither is a 500. The check is told which to expect by the
`SMOKE_BILLING_ENABLED` environment variable, which the workflow reads from a
`billing` input that defaults to `false`.

**Until you connect Stripe:** nothing to do. The default is already right.

**Once live mode is on:** edit `.github/workflows/deployed-version.yml` and
change the `billing` input's default from `"false"` to `"true"`:

```yaml
      billing:
        description: "Is Stripe connected on the site? Flip to true once the keys are set."
        required: false
        default: "true"     # <- was "false"
```

Commit it on a branch and merge it like any other change.

If you forget, the next deploy after connecting Stripe fails with:

```
FAIL  POST /api/billing/webhook with junk is 503 — 400 (want 503)
```

which is the check telling you it is out of date, not the site being broken.
Flip the default and it goes green.

You can also run the workflow by hand at any time — **Actions → Deployed
version → Run workflow** — and set **billing** to `true` or `false` for that
one run without changing the file.

---

## Turning billing back off

Delete any one of the five variables in Netlify and redeploy. The app returns
to "Opening soon". Teachers already subscribed keep their plan and quota —
their subscription row is untouched — but no new checkouts can start, and
webhooks are refused until it is switched back on.

---

## If it doesn't work

### The buttons still say "Opening soon"

One of the five variables is missing, empty, or the site has not been
redeployed since you added them. Check all five in Netlify — a variable that
exists but is blank counts as missing. Then redeploy.

### Checkout opens but the plan never changes in the app

The webhook is not arriving. In Stripe, go to the webhook endpoint page.
There is a list of recent deliveries with a status on each.

- **No deliveries at all** — the endpoint URL is wrong, or you created it in
  the other mode. Test-mode checkouts only fire test-mode webhooks.
- **400 responses** — the signing secret does not match. Copy it again from
  this exact endpoint and update `STRIPE_WEBHOOK_SECRET`, then redeploy.
- **503 responses** — billing is switched off at the app end. Same fix as
  "Opening soon" above.
- **500 responses** — the app received it and something went wrong inside.
  Read `billing_events` below; the reason is recorded there. Stripe will keep
  retrying for up to three days, so fixing the cause usually resolves it
  without any manual replay.

Click any delivery to see what Stripe sent and what the app answered.

### Reading the app's own record

Every webhook the app has seen is in the `billing_events` table. In Supabase,
open **SQL Editor** and run:

```sql
-- The last 50 events, newest first.
select event_id, type, received_at, processed_at, error
  from public.billing_events
 order by received_at desc
 limit 50;
```

`processed_at` filled in means it was handled. `processed_at` null with
something in `error` means it failed and will be retried on the next delivery.

To see only the ones that are stuck:

```sql
select event_id, type, received_at, error
  from public.billing_events
 where processed_at is null
 order by received_at desc;
```

And to see what a teacher's plan actually says right now:

```sql
select u.email, s.plan_id, s.status,
       s.current_period_start, s.current_period_end,
       s.stripe_customer_id, s.stripe_subscription_id
  from public.subscriptions s
  join auth.users u on u.id = s.teacher_id
 order by s.updated_at desc;
```

### A teacher says they paid but the app disagrees

Check the three things in order:

1. Stripe **Payments** — did the money actually arrive?
2. The webhook endpoint page — was the event delivered, and what did the app
   answer?
3. `billing_events` — is the event there, and does it have an error?

That sequence tells you which of the three parties is wrong, which is usually
the whole diagnosis.

---

## What is checked automatically

- `tests/billing-webhook.test.mjs` covers the event handling with fixtures:
  upgrade, downgrade, failed payment, cancellation, an out-of-order delivery
  that must not roll a teacher backwards, an unrecognised price id, and the
  signature check.
- `supabase/checks/billing-events.sql` can be pasted into the Supabase SQL
  editor at any time. It writes nothing — everything it does is rolled back —
  and confirms that one event cannot be processed twice and that a cancelled
  subscription is handed back to the monthly period roller.
- `scripts/smoke-live.mjs` runs against the real site on every deploy to
  `main`, from a GitHub runner. It is the only check that talks to production,
  and it exists because a redirect in `next.config.ts` once shadowed the
  sign-up page: the code was right, every local check passed, and the live
  site still sent teachers somewhere else. See the section above for its one
  setting.
