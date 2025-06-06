# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Development:**
```bash
npm run dev    # Start local development server with Wrangler
```

**Deployment:**
```bash
npm run deploy # Deploy to Cloudflare Workers
```

**Secrets Management:**
```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put X_API_KEY
wrangler secret put X_API_SECRET_KEY
wrangler secret put X_ACCESS_TOKEN
wrangler secret put X_ACCESS_TOKEN_SECRET
wrangler secret put TARGET_CHANGELOG_URL
```

## Architecture Overview

This is a Cloudflare Workers application that monitors software changelogs for updates and generates AI-powered summaries for social media posting.

### Core Flow:
1. **Scheduled Worker** runs every minute via cron trigger
2. **Change Detection**: Fetches changelog URL, converts HTML to Markdown, compares with KV-stored version
3. **AI Summarization**: Uses Google Gemini API to generate concise recaps from diffs
4. **Approval Workflow**: Sends Telegram notification with confirmation ID, stores pending posts in KV with 24h expiration
5. **Publishing**: HTTP endpoint `/confirm/:postID` triggers posting to X/Twitter

### Key Components:
- `src/index.ts`: Main worker logic with scheduled handler and HTTP router
- Uses `itty-router` for HTTP routing
- Cloudflare KV for state persistence (changelog history, pending posts)
- External services: Gemini API, Telegram Bot API, X API
- HTML to Markdown conversion using TurndownService
- Diff calculation using jsdiff library

### Environment Configuration:
Configuration requires both `wrangler.toml` setup and secrets:
- KV namespace: `CHANGELOG_KV` (must create in Cloudflare dashboard first)
- Required secrets (use `wrangler secret put`): All API keys and `TARGET_CHANGELOG_URL`
- Optional vars in `wrangler.toml`: `CHANGELOG_NAME`

### Design Considerations:
- **Security**: All sensitive data stored as Cloudflare secrets, not in wrangler.toml
- **Reliability**: Manual approval step prevents automated posting of incorrect summaries
- **Performance**: Stateless design with KV storage for persistence
- **Scalability**: Currently monitors single changelog; could extend to multiple

### Recent Improvements:
- **Security**: Moved all API keys from wrangler.toml to Cloudflare secrets
- **Performance**: Changed cron schedule from every minute to every 15 minutes
- **Reliability**: Added retry logic with exponential backoff for all API calls
- **Type Safety**: Created TypeScript interfaces for all API responses
- **Validation**: Added environment variable validation at startup
- **Configuration**: Made Gemini model settings configurable via environment variables
- **X/Twitter**: Implemented basic posting functionality (requires OAuth library for production)

### Known Limitations:
- X/Twitter OAuth 1.0a signature generation needs a proper library (src/index.ts:586-621)
- No multi-changelog support in current design
- Single KV namespace for all data (could separate changelog history from pending posts)