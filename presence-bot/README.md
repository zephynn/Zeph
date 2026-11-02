# presence-bot

A small self-hosted replacement for [Lanyard](https://github.com/Phineas/lanyard).
A Discord bot watches your presence and serves it in Lanyard's JSON format,
so the site's status dot, status bubble and activity cards work unchanged.

It can't run on Vercel, because it has to stay connected to Discord 24/7.
It runs on a free Google Cloud `e2-micro` VM, with Caddy in front of it
serving HTTPS on `presence.zephyn.dev`.

## Endpoints

| Path            | What it returns                                              |
| --------------- | ------------------------------------------------------------ |
| `/v1/presence`  | `{ success: true, data: {...} }`, a one-off snapshot          |
| `/v1/stream`    | Server-Sent Events, with a `presence` event on every change   |
| `/health`       | `ok`                                                         |

## Setup

### 1. Create the Discord bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Open **Bot** and click **Reset Token**. Copy the token and keep it private.
3. Still on **Bot**, under *Privileged Gateway Intents*, turn on
   **Presence Intent** and **Server Members Intent**.
4. Open **OAuth2 → URL Generator**, tick the `bot` scope (it needs no permissions),
   open the generated URL and add the bot to a server **you are in**.

### 2. Create the VM (Google Cloud console)

**Compute Engine → VM instances → Create instance**:

| Setting      | Value                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| Region       | `us-central1`, `us-west1` or `us-east1` (only these are in the free tier) |
| Machine type | `e2-micro`                                                             |
| Boot disk    | Debian 12, **Standard persistent disk**, 10 GB (the default "Balanced" disk is *not* free) |
| Firewall     | tick **Allow HTTP traffic** and **Allow HTTPS traffic**                |

Then, under **VPC network → IP addresses**, promote the VM's external IP to
**static**, so it doesn't change if the VM restarts.

### 3. Point DNS at it

Add an `A` record `presence.zephyn.dev` → the VM's static IP. The DNS for
zephyn.dev is managed by Vercel.

### 4. Run the setup script

Click **SSH** next to the VM, then run:

```bash
curl -fsSLO https://raw.githubusercontent.com/zephynn/Zeph/claude/hopeful-turing-2byj78/presence-bot/deploy/gcp-setup.sh
```

```bash
sudo bash gcp-setup.sh
```

It asks for the bot token once (input is hidden), then installs everything.
Check it at https://presence.zephyn.dev/v1/presence.

**Updating later:** run `sudo bash gcp-setup.sh` again. It pulls the latest
code and restarts the bot without asking for the token again.

**Logs:**

```bash
sudo journalctl -u presence-bot -f
```

### 5. Point the site at it

Set `discord.presenceUrl` in `src/config.ts` to `https://presence.zephyn.dev`
and redeploy the site. Leave it empty to use Lanyard instead.

## Notes

- **Invisible looks offline.** Discord reports Invisible to bots exactly the
  same way as Offline, so it can't be told apart.
- **Activities need activity sharing on.** Spotify and game cards only appear
  if *Settings → Activity Privacy → Share my activity* is on in Discord.
- **The bot keeps no history.** It only holds the current presence in memory.
  After a restart, it fetches your presence again on startup.
- **Changing the token:** edit `/etc/presence-bot.env` on the VM, then run
  `sudo systemctl restart presence-bot`.
