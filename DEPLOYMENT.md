# Deployment Guide for Changelog Monitor

This guide will walk you through deploying the Changelog Monitor to Cloudflare Workers.

## Prerequisites

- Node.js (v16+) and npm installed
- Cloudflare account (free tier works)
- Wrangler CLI (already included in devDependencies)
- API keys for external services

## Deployment Steps

### 1. Clone and Install Dependencies

```bash
npm install
```

### 2. Create Cloudflare KV Namespace

```bash
# Create KV namespace for production
wrangler kv:namespace create "CHANGELOG_KV"

# Create KV namespace for preview/development (optional)
wrangler kv:namespace create "CHANGELOG_KV" --preview
```

Copy the returned IDs and update `wrangler.toml`:

```toml
kv_namespaces = [
  { binding = "CHANGELOG_KV", id = "YOUR_KV_ID", preview_id = "YOUR_PREVIEW_KV_ID" }
]
```

### 3. Set Up External Services

#### Google Gemini API
1. Go to https://makersuite.google.com/app/apikey
2. Create a new API key
3. Save it for the secrets step

#### Telegram Bot
1. Message @BotFather on Telegram
2. Create a new bot with `/newbot`
3. Copy the bot token
4. Add the bot to a group/channel and get the chat ID
   - Send a message in the chat
   - Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find the chat ID in the response

#### X/Twitter API
1. Go to https://developer.twitter.com/
2. Create a project and app
3. Generate the following credentials:
   - API Key (Consumer Key)
   - API Secret Key (Consumer Secret)
   - Access Token
   - Access Token Secret

### 4. Configure Secrets

Add all secrets using Wrangler:

```bash
# Gemini API
wrangler secret put GEMINI_API_KEY
# Enter your Gemini API key when prompted

# Telegram
wrangler secret put TELEGRAM_BOT_TOKEN
# Enter your bot token when prompted

wrangler secret put TELEGRAM_CHAT_ID
# Enter your chat ID when prompted

# Target URL
wrangler secret put TARGET_CHANGELOG_URL
# Enter the changelog URL to monitor (e.g., https://example.com/changelog)

# X/Twitter credentials
wrangler secret put X_API_KEY
# Enter your Twitter API key

wrangler secret put X_API_SECRET_KEY
# Enter your Twitter API secret key

wrangler secret put X_ACCESS_TOKEN
# Enter your Twitter access token

wrangler secret put X_ACCESS_TOKEN_SECRET
# Enter your Twitter access token secret
```

### 5. Deploy to Cloudflare

```bash
npm run deploy
```

### 6. Verify Deployment

1. Check the Cloudflare dashboard for your worker
2. View real-time logs: `wrangler tail`
3. The worker will run every 15 minutes to check for changes

## Usage

### Monitoring
- The worker runs automatically every 15 minutes
- When changes are detected, you'll receive a Telegram notification
- The notification includes a confirmation ID

### Posting to X/Twitter
1. When you receive a Telegram notification with a recap
2. Visit: `https://your-worker.workers.dev/confirm/CONFIRMATION_ID`
3. The recap will be posted to X/Twitter

### Debugging
- View logs: `wrangler tail`
- Test locally: `npm run dev`
- Check KV storage: `wrangler kv:key list --namespace-id=YOUR_KV_ID`

## Configuration Options

Edit `wrangler.toml` to customize:

```toml
[vars]
CHANGELOG_NAME = "Your Product Changelog"  # Display name
GEMINI_MODEL = "gemini-1.5-flash-latest"   # AI model
GEMINI_TEMPERATURE = "0.6"                 # Creativity (0-1)
GEMINI_MAX_TOKENS = "250"                  # Max summary length
```

## Troubleshooting

### Common Issues

1. **"Missing required secret" errors**
   - Ensure all secrets are set with `wrangler secret list`
   - Re-add any missing secrets

2. **Twitter posting fails**
   - Verify all 4 Twitter credentials are correct
   - Check if the app has write permissions
   - Ensure the access token is for the correct account

3. **No Telegram notifications**
   - Verify bot token and chat ID
   - Ensure the bot is in the chat/group
   - Check if the bot has permission to send messages

4. **Changelog not detected**
   - Verify the TARGET_CHANGELOG_URL is accessible
   - Check if the URL returns valid HTML
   - View logs to see if the worker is running

### Support

For issues, check:
- Cloudflare Workers documentation: https://developers.cloudflare.com/workers/
- Wrangler CLI docs: https://developers.cloudflare.com/workers/wrangler/
- Worker logs: `wrangler tail`