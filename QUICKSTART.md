# Quick Start Guide - Changelog Monitor

Get your changelog monitor up and running in 10 minutes!

## Prerequisites
- Node.js 16+ installed
- Cloudflare account (free tier works)

## 1. Clone and Install (1 minute)

```bash
git clone <your-repo-url>
cd changelog-monitor
npm install
```

## 2. Get Your API Keys (5 minutes)

### Telegram Bot
1. Open Telegram and go to: https://t.me/botfather
2. Send `/newbot`
3. Choose a name: `My Changelog Monitor`
4. Choose a username: `my_changelog_bot` (must end with 'bot')
5. **Save the bot token** (looks like: `1234567890:ABCdef...`)
6. Start a chat with your new bot and send "Hello"
7. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
8. **Save the chat ID** from the response

### Google Gemini
1. Go to: https://makersuite.google.com/app/apikey
2. Click "Create API Key"
3. **Save the API key**

### X/Twitter (Optional - for posting)
1. Go to: https://developer.twitter.com/
2. Create a project and app
3. **Save all 4 credentials**:
   - API Key & Secret
   - Access Token & Secret

## 3. Setup Cloudflare (2 minutes)

```bash
# Login to Cloudflare
npx wrangler login

# Create KV storage
npx wrangler kv:namespace create "CHANGELOG_KV"
```

Copy the ID from the output and update `wrangler.toml` line 12:
```toml
{ binding = "CHANGELOG_KV", id = "paste-your-id-here" }
```

## 4. Add Your Secrets (2 minutes)

Run each command and paste the value when prompted:

```bash
# Required
npx wrangler secret put TELEGRAM_BOT_TOKEN      # Your bot token
npx wrangler secret put TELEGRAM_CHAT_ID        # Your chat ID
npx wrangler secret put GEMINI_API_KEY          # Your Gemini key
npx wrangler secret put TARGET_CHANGELOG_URL    # URL to monitor (e.g., https://example.com/changelog)

# For X/Twitter posting (optional)
npx wrangler secret put X_API_KEY
npx wrangler secret put X_API_SECRET_KEY
npx wrangler secret put X_ACCESS_TOKEN
npx wrangler secret put X_ACCESS_TOKEN_SECRET
```

## 5. Deploy! (30 seconds)

```bash
npm run deploy
```

## 6. You're Done! 🎉

Your monitor is now:
- ✅ Checking the changelog every 15 minutes
- ✅ Sending Telegram alerts when changes are found
- ✅ Ready to post to X/Twitter with one click

### Test It
1. Watch logs: `npx wrangler tail`
2. When you get a Telegram notification, click the confirmation link to post

### Customize (Optional)
Edit `wrangler.toml` to change:
- `CHANGELOG_NAME`: Display name in notifications
- Check frequency: Change `crons = ["*/15 * * * *"]`

## Common Issues

**No Telegram messages?**
- Check bot token and chat ID are correct
- Make sure you started a chat with your bot

**"Missing required secret" error?**
- List secrets: `npx wrangler secret list`
- Re-add any missing ones

**Need help?**
- Check logs: `npx wrangler tail`
- See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions