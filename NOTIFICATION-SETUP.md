# College Football Scoreboard v1.2 — Notification Setup

The scoreboard itself remains on GitHub Pages. A tiny Cloudflare Worker checks games once per minute and sends standards-based Web Push notifications to the Home Screen web app.

## 1. Upload v1.2 to the GitHub repository

At the repository root, replace `index.html` and add:

- `service-worker.js`
- `manifest.webmanifest`
- the entire `worker` folder

Commit the changes. GitHub Pages will redeploy the scoreboard as before.

## 2. Deploy the notification Worker on Cloudflare

1. Create/sign in to a free Cloudflare account.
2. Open **Workers & Pages**.
3. Choose **Create application** and import the same GitHub repository used by the scoreboard.
4. Configure the Worker project to use the repository subdirectory **`worker`** as its root directory.
5. The Worker name must be **`cfb-scoreboard-notifications`** (this matches `worker/wrangler.jsonc`).
6. Use `npx wrangler deploy` as the deploy command if Cloudflare asks for one. Dependencies are listed in `worker/package.json`.
7. Deploy.

The included Wrangler configuration automatically creates the stateful Durable Object and the once-per-minute Cron Trigger. There are no API keys or private push keys for you to create or paste: the Worker generates its VAPID key pair on first use and stores it privately in the Durable Object.

After deployment, Cloudflare will show a URL similar to:

`https://cfb-scoreboard-notifications.YOUR-SUBDOMAIN.workers.dev`

Keep that address handy.

## 3. Re-add the scoreboard to the iPhone Home Screen

Because v1.2 adds a proper Web App Manifest and service worker, remove the old Home Screen shortcut, visit the updated GitHub Pages site in Safari, and choose **Share → Add to Home Screen** again.

Open the scoreboard from the new Home Screen icon.

## 4. Turn on alerts

1. Tap **Enable Alerts** in the scoreboard controls.
2. The first time only, paste the Cloudflare Worker URL from step 2.
3. Tap **Allow** when iOS asks for notification permission.
4. The button changes to **Alerts On**.

The app sends the current favorites list to the Worker. Adding or removing a heart later automatically updates the notification service.

## Notification rules

For favorited teams:
- Kickoff
- Any live score change
- Halftime
- Final score

For all FBS games:
- **UPSET ALERT** starts when an unranked team takes the lead in the 4th quarter against a Top-15 team.
- Once started, a tie does not clear the alert. It stays active until the ranked team takes the lead back or the game ends.
- **UPSET** is sent if the unranked team wins.

The Worker checks ESPN's unofficial FBS scoreboard once per minute, so a notification can lag the provider's score update by roughly a minute (and sometimes longer if ESPN itself updates slowly).

## Cost

This design is intended to fit comfortably inside Cloudflare's free Workers/Durable Objects usage for personal use. Free-tier limits can change, so check Cloudflare's dashboard if it ever reports usage-limit errors.
