# Design Document: Automated Changelog Monitor & Social Publisher

## 1. Introduction

This document outlines the design for an automated system that monitors a specified changelog webpage, generates a summary of changes, and facilitates publishing these updates to social media (initially X/Twitter) after user confirmation via Telegram.

The system is implemented as a Cloudflare Worker, leveraging various Cloudflare services and external APIs.

## 2. Goals

*   Automatically detect changes in a target changelog page.
*   Extract relevant content from the page and convert it to Markdown.
*   Identify the differences between the current and previous versions of the changelog.
*   Generate a concise, human-readable summary of these changes using a Large Language Model (Gemini 2.5 Flash).
*   Notify a user (or group) on Telegram about the detected changes and the generated summary.
*   Allow the user to confirm via Telegram whether the summary should be published.
*   Upon confirmation, publish the summary to X (Twitter).

## 3. Architecture

The system is a serverless application running on Cloudflare Workers.

*   **Cloudflare Worker:** Hosts the core logic.
    *   **Scheduled Event Handler:** Triggered by a cron job to periodically check the changelog.
    *   **HTTP Request Handler:** Handles incoming requests, specifically for confirming posts via Telegram.
*   **Cloudflare KV:** Used for persistent storage:
    *   Stores the Markdown content of the last known version of the changelog.
    *   Stores details of pending posts (recap, diff, unique ID, status) awaiting user confirmation.
*   **External Services:**
    *   **Target Changelog Webpage:** The source of information (configurable URL).
    *   **Gemini API:** To summarize the detected changes.
    *   **Telegram Bot API:** To send notifications and receive confirmation triggers (via an external bot).
    *   **X (Twitter) API:** To publish the final recap (currently a placeholder).

## 4. Components & Workflow

### 4.1. Scheduled Changelog Check (Cron Trigger - every minute)

1.  **Fetch Changelog:** The worker fetches the content of the `TARGET_CHANGELOG_URL`.
2.  **Convert to Markdown:** The HTML content is converted to Markdown using the Turndown library.
3.  **Compare with Previous Version:**
    *   The worker retrieves the last stored Markdown version from Cloudflare KV (`latest_changelog_markdown` key).
    *   If no previous version exists, the current Markdown is stored, and the process for this cycle ends.
    *   If the current Markdown is identical to the previous one, no changes are detected, and the process ends.
4.  **Calculate Diff:** If changes are detected, the `diffLines` function (from the `jsdiff` library) calculates the differences between the old and new Markdown content.
5.  **Generate Recap (Gemini API):**
    *   The calculated diff is sent to the Gemini 2.5 Flash model with a prompt to summarize the changes.
    *   If the recap generation is successful:
        *   A unique `postID` (UUID) is generated.
        *   An object containing the `recap`, `diff`, `originalChangelogUrl`, `timestamp`, and a status of `PENDING_CONFIRMATION` is created.
        *   This object is stored in Cloudflare KV, keyed by `post:<postID>`, with a 24-hour expiration.
6.  **Notify User (Telegram):**
    *   A message is sent via the Telegram Bot API to a configured chat ID.
    *   The message includes:
        *   The name of the monitored changelog (e.g., `CHANGELOG_NAME`).
        *   The Gemini-generated recap.
        *   The unique `postID`.
        *   Instructions for the user to confirm the post (e.g., "send `/confirm_post <postID>` to your bot").
7.  **Update Stored Changelog:** The new Markdown content is stored in KV, overwriting `latest_changelog_markdown`.

### 4.2. Post Confirmation (HTTP Endpoint - `/confirm/:postID`)

This endpoint is intended to be called by an external Telegram bot that the user interacts with.

1.  **Receive Request:** The worker receives a GET request to `/confirm/:postID`.
2.  **Validate `postID`:**
    *   The worker retrieves the data associated with `post:<postID>` from KV.
    *   If not found (or expired), a 404 error is returned.
    *   If the post status is already `POSTED_TO_X`, a message indicating this is returned.
    *   If the post status is not `PENDING_CONFIRMATION` (and not `POSTED_TO_X`), an error is returned.
3.  **Publish to X (Placeholder):**
    *   The `postToX` function is called with the recap content and X API credentials (from environment variables).
    *   **Note:** Currently, this function is a placeholder. It simulates success if API keys are present. A full implementation requires OAuth 1.0a signing and interaction with the X API.
4.  **Update KV and Notify:**
    *   **On Success:**
        *   The status of the post in KV is updated to `POSTED_TO_X` (and expiration is removed).
        *   A success message is sent via Telegram.
        *   A JSON success response is returned.
    *   **On Failure:**
        *   The status of the post in KV is updated to `FAILED_TO_POST`.
        *   A failure message is sent via Telegram.
        *   A JSON error response is returned.

## 5. Configuration

The system relies on environment variables and secrets configured in `wrangler.toml` and the Cloudflare dashboard:

*   `TARGET_CHANGELOG_URL`: The URL of the changelog to monitor.
*   `CHANGELOG_NAME` (optional): A friendly name for the changelog source used in notifications.
*   `CHANGELOG_KV`: Binding to the Cloudflare KV namespace.
*   `GEMINI_API_KEY`: API key for the Gemini API.
*   `TELEGRAM_BOT_TOKEN`: Token for the Telegram bot.
*   `TELEGRAM_CHAT_ID`: Chat ID for Telegram notifications.
*   `X_API_KEY`, `X_API_SECRET_KEY`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`: Credentials for the X (Twitter) API.

## 6. Future Enhancements (Potential)

*   Full implementation of `postToX` with robust X API v2 interaction.
*   More sophisticated HTML parsing and content extraction if Turndown is insufficient for specific changelog structures.
*   Support for multiple changelog sources.
*   More detailed error reporting via Telegram.
*   A web UI for managing monitored changelogs or viewing post history.
*   Option to edit the recap before confirming.
*   Secure the `/confirm/:postID` endpoint (e.g., with a shared secret passed by the Telegram bot). 