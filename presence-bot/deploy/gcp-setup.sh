#!/usr/bin/env bash
# Sets up (or updates) the zephyn presence bot on a fresh Debian 12 VM
# (Google Cloud e2-micro). Safe to re-run: the first run asks for the bot
# token; later runs just pull the latest code and restart.
#
#   curl -fsSLO https://raw.githubusercontent.com/zephynn/Zeph/claude/hopeful-turing-2byj78/presence-bot/deploy/gcp-setup.sh
#   sudo bash gcp-setup.sh
#
# What it installs:
#   - Node.js 22, the bot from GitHub, and a systemd service that restarts it
#     on crash and starts it on boot
#   - Caddy, which serves the bot on https://$DOMAIN with an automatic
#     Let's Encrypt certificate
#   - 1 GB of swap, because the e2-micro only has 1 GB of RAM
set -euo pipefail

DOMAIN="${DOMAIN:-presence.zephyn.dev}"
BRANCH="${BRANCH:-claude/hopeful-turing-2byj78}"
DISCORD_USER_ID="${DISCORD_USER_ID:-1491487646424498357}"
REPO="https://github.com/zephynn/Zeph.git"
APP_DIR="/opt/zeph"
ENV_FILE="/etc/presence-bot.env"
SERVICE_USER="presence"

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo bash $0" >&2
  exit 1
fi

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- Swap (npm install can run out of memory on 1 GB) ---
if ! swapon --show | grep -q /swapfile; then
  step "Adding 1 GB swap"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Base packages ---
step "Installing base packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# --- Node.js 22 ---
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  step "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

# --- Caddy ---
if ! command -v caddy >/dev/null; then
  step "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# --- Service user ---
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

# --- Code (only the presence-bot folder) ---
if [[ -d "$APP_DIR/.git" ]]; then
  step "Updating code ($BRANCH)"
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  step "Downloading code ($BRANCH)"
  git clone -q --depth 1 --branch "$BRANCH" --filter=blob:none --sparse "$REPO" "$APP_DIR"
  git -C "$APP_DIR" sparse-checkout set presence-bot
fi

step "Installing bot dependencies"
cd "$APP_DIR/presence-bot"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# --- Secrets (asked once, kept root-only) ---
if [[ ! -s "$ENV_FILE" ]]; then
  step "Bot token"
  echo "Paste your Discord bot token (input is hidden), then press Enter:"
  read -rs DISCORD_BOT_TOKEN < /dev/tty
  echo
  if [[ -z "$DISCORD_BOT_TOKEN" ]]; then
    echo "No token entered. Re-run the script to try again." >&2
    exit 1
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN
DISCORD_USER_ID=$DISCORD_USER_ID
HOST=127.0.0.1
PORT=3000
EOF
  unset DISCORD_BOT_TOKEN
fi

# --- systemd service ---
step "Configuring the bot service"
cat > /etc/systemd/system/presence-bot.service <<EOF
[Unit]
Description=zephyn Discord presence bot
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
WorkingDirectory=$APP_DIR/presence-bot
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
# Basic hardening — the bot only needs network access and its own folder.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet presence-bot
systemctl restart presence-bot

# --- Caddy (HTTPS in front of the bot) ---
step "Configuring HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	reverse_proxy 127.0.0.1:3000 {
		# Send Server-Sent Events straight through instead of buffering them.
		flush_interval -1
	}
}
EOF
systemctl reload caddy || systemctl restart caddy

# --- Check ---
sleep 4
step "Status"
systemctl --no-pager --lines=8 status presence-bot || true
echo
if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
  echo "Bot is running."
else
  echo "Bot isn't answering yet. Logs: sudo journalctl -u presence-bot -n 50"
fi
echo "Public URL (works once DNS points here): https://$DOMAIN/v1/presence"
echo "Server IP: $(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || echo unknown)"
