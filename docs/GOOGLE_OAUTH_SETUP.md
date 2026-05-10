# Google OAuth (Gmail sign-in) — production setup

## Why this doc exists

In dev Clerk, `Sign in with Google` uses Clerk's own shared OAuth app (the one that shows `clerk.accounts.dev` branding on Google's consent screen). Prod Clerk refuses to use that app — Google requires the consent screen to display **your** product name, not Clerk's.

Until the steps below are done, the Google button on faivri.com will 400 with `Missing required parameter: client_id`. The frontend currently hides the button until configuration is complete ([frontend/src/components/Providers.tsx](../frontend/src/components/Providers.tsx)). Email sign-in still works.

Total time: ~10 minutes.

---

## Step 1 — Google Cloud project

1. Open https://console.cloud.google.com
2. Project dropdown (top bar) → **New Project** → name `Faivri` → Create
3. Make sure the project is selected in the dropdown for every step below.

## Step 2 — OAuth consent screen

1. Sidebar → **APIs & Services → OAuth consent screen**
2. User type: **External** → Create
3. Fields:
   - App name: `Faivri`
   - User support email: `support@faivri.com`
   - App logo: optional (upload a 120×120 PNG)
   - Application home page: `https://faivri.com`
   - Application privacy policy link: `https://faivri.com/privacy`
   - Application terms of service link: `https://faivri.com/privacy` (or a separate TOS page if you build one)
   - Authorized domains: `faivri.com`
   - Developer contact: `support@faivri.com`
4. Scopes: click **Add or remove scopes** → select `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid` → Update → Save and continue
5. Test users: skip (or add 1–2 emails if you want to test before publishing)
6. **Publish app** on the summary page — this moves it out of Testing mode so any Gmail user can sign in without being a listed tester.

> **Publishing warning:** If your scopes stay at `email / profile / openid` (which they should — no Drive, no Gmail, no Calendar), Google will **not** require verification to publish. The app goes live immediately.

## Step 3 — OAuth 2.0 Client ID

1. Sidebar → **APIs & Services → Credentials**
2. **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Faivri — Clerk`
5. Authorized JavaScript origins:
   - `https://faivri.com`
   - `https://accounts.faivri.com`
   - `https://clerk.faivri.com`
6. **Authorized redirect URIs:** leave empty for now — Clerk will give you the exact value in step 4.
7. **Create.** Copy the **Client ID** and **Client Secret** shown in the modal. The secret is only shown once — keep it somewhere safe for the next step.

## Step 4 — Paste credentials into Clerk

1. Open https://dashboard.clerk.com → select the **prod** instance (faivri.com — the one with the crown icon, not the dev instance)
2. Sidebar → **User & Authentication → Social Connections**
3. Click the **Google** row → toggle **Use custom credentials** ON
4. A new pane appears with an **Authorized redirect URI** — it looks like:
   ```
   https://clerk.faivri.com/v1/oauth_callback
   ```
5. Copy that URL → back to Google Cloud Console → **Credentials → your OAuth client** → **Authorized redirect URIs** → Add URI → paste → Save.
6. Back in Clerk: paste the **Client ID** and **Client Secret** from step 3 → Save.

## Step 5 — Re-enable the Google button on faivri.com

Open [`frontend/src/components/Providers.tsx`](../frontend/src/components/Providers.tsx) and remove the three hidden-classes — roughly lines 22–37:

```diff
-          // Social providers hidden until prod OAuth credentials are registered
-          // in Clerk Dashboard. Without a custom client_id/secret, prod Clerk
-          // hits Google with an empty client_id and users see Error 400.
-          // Email + magic-link auth works immediately; re-enable by removing
-          // these two rules after configuring Google/etc. in the dashboard.
-          socialButtons: 'hidden',
-          socialButtonsBlockButton: 'hidden',
-          dividerRow: 'hidden',
+          socialButtonsBlockButton:
+            'border border-[rgba(55,53,47,0.16)] bg-[#F7F6F3] text-[#37352F] hover:bg-[#EFEDEA]',
```

Then redeploy (full rebuild — `NEXT_PUBLIC_*` are baked at build time so `railway redeploy` is not enough):

```bash
cd frontend
railway up --ci --service faircheck-frontend
```

## Step 6 — Verify

1. Open **incognito** https://faivri.com/sign-up
2. You should see a **Continue with Google** button above the email form.
3. Click it → Google consent screen should show **Faivri** as the app name and the scopes `Email address, See your personal info including …`.
4. Approve → you land back on faivri.com signed in with your Gmail address.
5. Open https://dashboard.clerk.com → Users → confirm the new user row exists with `External accounts: Google`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error 400: redirect_uri_mismatch` | The redirect URI in Google Cloud Console doesn't match the one Clerk generated. Copy the exact string Clerk shows and paste into Google → Credentials → your OAuth client → Authorized redirect URIs. |
| `Error 403: access_denied` with "This app has not been verified" | OAuth consent screen is in Testing. Either add the user's email under Test users or click **Publish App** to go External-Production. |
| Consent screen still says `clerk.accounts.dev` | You set up credentials on the **dev** Clerk instance by mistake. Switch to the prod instance at the top-left of the Clerk Dashboard. |
| Google button shows but returns 400 after pressing it | `Client ID` or `Client Secret` was pasted with leading/trailing whitespace. Re-open Clerk Dashboard → Social Connections → Google → re-paste. |
| Users can sign in but get "Your session may have expired" immediately after | Backend rejected the JWT. Either `CLERK_ALLOWED_ISSUER_HOSTS=.faivri.com` is missing from Railway backend vars, or the pk/sk pair is mixed with the dev instance. Run `railway variables --service faircheck-backend \| grep CLERK`. |

## Other social providers

Same pattern for GitHub, Apple, Microsoft, LinkedIn, etc. — each needs its own OAuth app under that provider's developer console, with the Clerk redirect URI whitelisted, then credentials pasted back into the matching row on **Clerk → Social Connections**.
