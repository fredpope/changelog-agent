# Changelog Monitor

A Cloudflare Workers application that monitors software changelogs for updates and automatically generates AI-powered summaries for social media posting.

## Features

- 🔄 **Automatic Monitoring**: Checks changelogs every 15 minutes
- 🤖 **AI-Powered Summaries**: Uses Google Gemini to create concise, engaging recaps
- 📱 **Telegram Notifications**: Instant alerts when changes are detected
- ✅ **Manual Approval**: Review summaries before posting
- 🐦 **X/Twitter Integration**: Post updates directly to social media
- 🔒 **Secure**: All credentials stored as encrypted secrets
- 🚀 **Edge Computing**: Runs on Cloudflare's global network

## How It Works

1. **Monitor**: The worker runs on a schedule to fetch and check your changelog
2. **Detect**: Compares the current version with the previously stored version
3. **Summarize**: When changes are found, generates an AI summary of the updates
4. **Notify**: Sends the summary to Telegram with a confirmation ID
5. **Approve**: Visit the confirmation URL to post the update to X/Twitter

## Quick Start

### Prerequisites
- Node.js v16+ and npm
- Cloudflare account (free tier works)
- Google Gemini API key
- Telegram bot token
- X/Twitter API credentials

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd changelog-monitor

# Install dependencies
npm install
```

### Setup

1. **Create KV Namespace**:
   ```bash
   wrangler kv:namespace create "CHANGELOG_KV"
   ```

2. **Update wrangler.toml** with your KV namespace ID

3. **Add Secrets**:
   ```bash
   wrangler secret put GEMINI_API_KEY
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   wrangler secret put TARGET_CHANGELOG_URL
   wrangler secret put X_API_KEY
   wrangler secret put X_API_SECRET_KEY
   wrangler secret put X_ACCESS_TOKEN
   wrangler secret put X_ACCESS_TOKEN_SECRET
   ```

4. **Deploy**:
   ```bash
   npm run deploy
   ```

## Configuration

Edit `wrangler.toml` to customize:

```toml
[vars]
CHANGELOG_NAME = "My Product"        # Display name in notifications
GEMINI_MODEL = "gemini-1.5-flash-latest"  # AI model to use
GEMINI_TEMPERATURE = "0.6"           # Creativity level (0-1)
GEMINI_MAX_TOKENS = "250"            # Maximum summary length
```

## Development

```bash
# Run locally
npm run dev

# View logs
wrangler tail

# Deploy to production
npm run deploy
```

## API Endpoints

- `GET /confirm/:postID` - Confirm and post a changelog update to X/Twitter

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Cloudflare    │────▶│   Changelog     │     │   Google        │
│   Workers       │     │   Website       │     │   Gemini API    │
│   (Scheduler)   │     │                 │     │                 │
└────────┬────────┘     └─────────────────┘     └────────▲────────┘
         │                                                │
         │                                                │
         ▼                                                │
┌─────────────────┐                             Generate Summary
│                 │                                       │
│   Cloudflare    │                                       │
│   KV Storage    │◀──────────────────────────────────────┘
│                 │
└────────┬────────┘
         │
         │ Store & Compare
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Telegram      │────▶│   Manual        │────▶│   X/Twitter     │
│   Notification  │     │   Approval      │     │   API           │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Security

- All API keys and sensitive data are stored as Cloudflare secrets
- OAuth 1.0a authentication for X/Twitter API
- Manual approval step prevents automated posting of incorrect content
- Environment validation ensures all required secrets are present

## Troubleshooting

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup instructions and troubleshooting tips.

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Future Enhancements

- [ ] Support for multiple changelog monitoring
- [ ] Additional social media platforms (LinkedIn, Mastodon)
- [ ] Customizable summary templates
- [ ] Webhook support for real-time updates
- [ ] Dashboard for managing monitored changelogs