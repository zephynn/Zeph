# presence-bot

A small self-hosted replacement for [Lanyard](https://github.com/Phineas/lanyard).
A Discord bot watches your presence and serves it in Lanyard's JSON format,
so the site's status dot, status bubble and activity cards work unchanged.

It can't run on Vercel, because it has to stay connected to Discord 24/7.
It runs on Railway instead.

## Endpoints

| Path            | What it returns                                              |
| --------------- | ------------------------------------------------------------ |
| `/v1/presence`  | `{ success: true, data: {...} }`, a one-off snapshot          |
| `/v1/stream`    | Server-Sent Events, with a `presence` event on every change   |
| `/health`       | `ok`                                                         |

## Setup

### 1. Create the bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Open **Bot** and click **Reset Token**. Copy the token and keep it private.
3. Still on **Bot**, under *Privileged Gateway Intents*, turn on
   **Presence Intent** and **Server Members Intent**.
4. Open **OAuth2 → URL Generator**, tick the `bot` scope (it needs no permissions),
   open the generated URL and add the bot to a server **you are in**.
   A private server with just you and the bot is ideal.

### 2. Deploy on Railway

1. On https://railway.com, create a project with **Deploy from GitHub repo** and pick `zephynn/Zeph`.
2. In the service's **Settings**:
   - **Root Directory**: `presence-bot`
   - **Branch**: the branch you deploy from
3. In **Variables**, add:
   - `DISCORD_BOT_TOKEN`: the token from step 1
   - `DISCORD_USER_ID`: `1491487646424498357`
4. In **Settings → Networking**, click **Generate Domain**.
5. Open `https://<that-domain>/v1/presence`. It should show your status.

### 3. Point the site at it

Set `discord.presenceUrl` in `src/config.ts` to the Railway domain
(for example `https://zephyn-presence.up.railway.app`) and redeploy the site.
Leave it empty to use Lanyard instead.

## Notes

- **Invisible looks offline.** Discord reports Invisible to bots exactly the
  same way as Offline, so it can't be told apart.
- **Activities need activity sharing on.** Spotify and game cards only appear
  if *Settings → Activity Privacy → Share my activity* is on in Discord.
- **The bot keeps no history.** It only holds the current presence in memory.
  After a restart, it fetches your presence again on startup.
