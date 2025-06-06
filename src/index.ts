// src/index.ts
import { NodeHtmlMarkdown } from 'node-html-markdown-cloudflare';
import { diffLines, type Change } from 'diff';
import { Router } from 'itty-router';

// Import Cloudflare Workers types
export type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types';

export interface Env {
  CHANGELOG_KV: KVNamespace;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  CHANGELOG_NAME?: string;
  WORKER_URL: string;
  // X (Twitter) API Credentials
  X_API_KEY: string;
  X_API_SECRET_KEY: string;
  X_ACCESS_TOKEN: string;
  X_ACCESS_TOKEN_SECRET: string;
  TARGET_CHANGELOG_URL: string;
  // Configuration variables
  GEMINI_MODEL?: string;
  GEMINI_TEMPERATURE?: string;
  GEMINI_MAX_TOKENS?: string;
}

interface PendingPostData {
  recap: string;
  diff: string;
  originalChangelogUrl: string;
  timestamp: string;
  status: 'PENDING_CONFIRMATION' | 'POSTED_TO_X' | 'FAILED_TO_POST';
}

// Gemini API Response Types
interface GeminiResponse {
  candidates: GeminiCandidate[];
  promptFeedback?: {
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
    blockReason?: string;
  };
}

interface GeminiCandidate {
  content: {
    parts: Array<{
      text: string;
    }>;
    role: string;
  };
  finishReason?: string;
  index: number;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

// Telegram API Response Types
interface TelegramResponse {
  ok: boolean;
  result?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text: string;
  };
  error_code?: number;
  description?: string;
}

// Twitter API Response Types (for future implementation)
interface TwitterResponse {
  data?: {
    id: string;
    text: string;
  };
  errors?: Array<{
    title: string;
    detail: string;
    type: string;
  }>;
}

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2
};

// Generic retry function with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  config = RETRY_CONFIG,
  operationName = 'operation'
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`${operationName} attempt ${attempt}/${config.maxAttempts} failed:`, error);
      
      if (attempt < config.maxAttempts) {
        const delay = Math.min(
          config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelay
        );
        console.log(`Retrying ${operationName} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

// Create a new router instance
const router = Router();

// Validate required environment variables
function validateEnv(env: Env): string[] {
  const errors: string[] = [];
  
  // Required secrets
  const requiredSecrets = [
    'GEMINI_API_KEY',
    'TELEGRAM_BOT_TOKEN', 
    'TELEGRAM_CHAT_ID',
    'TARGET_CHANGELOG_URL',
    'X_API_KEY',
    'X_API_SECRET_KEY',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET'
  ];
  
  for (const secret of requiredSecrets) {
    if (!env[secret as keyof Env]) {
      errors.push(`Missing required secret: ${secret}`);
    }
  }
  
  // Validate optional numeric configs if provided
  if (env.GEMINI_TEMPERATURE) {
    const temp = parseFloat(env.GEMINI_TEMPERATURE);
    if (isNaN(temp) || temp < 0 || temp > 1) {
      errors.push(`Invalid GEMINI_TEMPERATURE: must be a number between 0 and 1`);
    }
  }
  
  if (env.GEMINI_MAX_TOKENS) {
    const tokens = parseInt(env.GEMINI_MAX_TOKENS);
    if (isNaN(tokens) || tokens < 1) {
      errors.push(`Invalid GEMINI_MAX_TOKENS: must be a positive integer`);
    }
  }
  
  return errors;
}

// ---- Main Scheduled Task ----
async function handleScheduled(
  _controller: ScheduledController | null,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const triggerSource = _controller?.cron ? `Cron trigger "${_controller.cron}"` : "Manual trigger";
  console.log(`${triggerSource}: Checking changelog...`);
  
  // Validate environment on first run
  const validationErrors = validateEnv(env);
  if (validationErrors.length > 0) {
    console.error("Environment validation failed:", validationErrors);
    await sendTelegramMessage(
      `⚠️ Changelog Monitor Error: Environment validation failed\n\n${validationErrors.join('\n')}`,
      env.TELEGRAM_BOT_TOKEN || '',
      env.TELEGRAM_CHAT_ID || ''
    ).catch(e => console.error("Failed to send error notification:", e));
    return;
  }

  const changelogUrl = env.TARGET_CHANGELOG_URL;

  try {
    const pageContent = await withRetry(
      async () => {
        const response = await fetch(changelogUrl);
        if (!response.ok) {
          throw new Error(`Error fetching changelog: ${response.status} ${response.statusText}`);
        }
        return await response.text();
      },
      RETRY_CONFIG,
      'Fetch changelog'
    );
    const markdownContent = await convertToMarkdown(pageContent);

    const currentKvKey = "latest_changelog_markdown";
    const previousMarkdown = await env.CHANGELOG_KV.get(currentKvKey);

    if (previousMarkdown === null) {
      console.log("No previous changelog found. Storing current version.");
      await env.CHANGELOG_KV.put(currentKvKey, markdownContent);
    } else if (previousMarkdown === markdownContent) {
      console.log("Changelog content hasn't changed.");
    } else {
      console.log("Changelog has changed. Processing diff...");
      const diff = calculateDiff(previousMarkdown, markdownContent);
      console.log("Diff:\n", diff);

      if (diff === "No textual differences found.") {
        console.log("Diff calculation found no substantive changes. Skipping further processing.");
      } else {
        const recap = await getGeminiRecap(diff, env);

        if (recap) {
          console.log("Gemini Recap:", recap);
          const postId = crypto.randomUUID();
          const pendingPost: PendingPostData = {
            recap,
            diff,
            originalChangelogUrl: changelogUrl,
            timestamp: new Date().toISOString(),
            status: 'PENDING_CONFIRMATION',
          };

          await env.CHANGELOG_KV.put(`post:${postId}`, JSON.stringify(pendingPost), { expirationTtl: 86400 }); // Expires in 24 hours

          const confirmationUrl = `${env.WORKER_URL}/confirm/${postId}`;
          const confirmationMessage = `New changelog detected for *${env.CHANGELOG_NAME || changelogUrl}*!\n\n*Recap:*\n${recap}\n\n[Click here to post this update to X](${confirmationUrl})\n\n(Note: This is an automated summary. Please verify the original changelog.)`;
          await sendTelegramMessage(confirmationMessage, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
        } else {
          console.log("Gemini recap failed or was empty. No post will be created.");
        }
      }
      await env.CHANGELOG_KV.put(currentKvKey, markdownContent);
    }
  } catch (error) {
    console.error("Error in scheduled task:", error);
    // Optionally send a Telegram message about the error
    await sendTelegramMessage(`Error in changelog monitor: ${error.message}`, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
  }
}

// ---- HTTP Endpoints ----
router.get("/", async (_request: any, _env: Env) => {
  return new Response("Changelog Monitor is running!", { 
    status: 200, 
    headers: { 'Content-Type': 'text/plain' } 
  });
});

router.get("/favicon.ico", async (_request: any, _env: Env) => {
  return new Response(null, { status: 204 });
});

// Catch-all for 404s
router.all("*", async (_request: any, _env: Env) => {
  return new Response("404, not found!", { status: 404 });
});

// ---- Exported Worker Handlers ----
export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleScheduled(controller, env, ctx));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    console.log(`[${new Date().toISOString()}] ${request.method} request received for path: ${pathname}`);

    if (pathname === '/') {
      // Manually trigger the changelog check in the background
      ctx.waitUntil(handleScheduled(null, env, ctx));
      return new Response(
        'Manual changelog check triggered. You will receive a Telegram notification if changes are found.',
        { status: 202, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    if (pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    const confirmMatch = pathname.match(/^\/confirm\/([a-fA-F0-9-]+)$/);
    if (confirmMatch) {
      const postID = confirmMatch[1];

      if (request.method === 'GET') {
        console.log(`[${postID}] Serving confirmation page.`);
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Confirm Post</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; color: #333; }
                .container { text-align: center; padding: 2rem; background-color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                h1 { font-size: 1.5rem; margin-bottom: 1rem; }
                p { margin-bottom: 2rem; }
                button { font-size: 1.1rem; padding: 0.8rem 1.5rem; cursor: pointer; border-radius: 5px; border: none; color: white; background-color: #1DA1F2; font-weight: bold; }
                button:hover { background-color: #0c85d0; }
                .footer { margin-top: 2rem; font-size: 0.8rem; color: #888; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Confirm Post to X</h1>
                <p>An automated summary has been generated for the latest changelog. Press the button below to post it.</p>
                <form method="post" action="${url.href}">
                  <button type="submit">Post to X</button>
                </form>
              </div>
              <div class="footer">Changelog Monitor</div>
            </body>
          </html>
        `;
        return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
      }

      if (request.method === 'POST') {
        ctx.waitUntil((async () => {
          console.log(`[${postID}] Received POST confirmation. Processing...`);
          const kvKey = `post:${postID}`;
          const storedData = await env.CHANGELOG_KV.get(kvKey);

          if (!storedData) {
            console.error(`[${postID}] POST confirmation failed: Pending post not found or expired.`);
            await sendTelegramMessage(`❌ Failed to post changelog update (ID: ${postID}). The confirmation link may have expired.`, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
            return;
          }

          const pendingPost = JSON.parse(storedData) as PendingPostData;

          if (pendingPost.status === 'POSTED_TO_X') {
            console.log(`[${postID}] Post has already been published. No action taken.`);
            await sendTelegramMessage(`ℹ️ This post (ID: ${postID}) has already been published to X.`, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
            return;
          }

          if (pendingPost.status !== 'PENDING_CONFIRMATION') {
            console.error(`[${postID}] Post is not pending confirmation. Current status: ${pendingPost.status}.`);
            await sendTelegramMessage(`❌ Failed to post changelog update (ID: ${postID}). Status was not pending confirmation.`, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
            return;
          }
          
          try {
            const result = await postToX(postID, pendingPost.recap, env);
            if (result.success) {
              pendingPost.status = 'POSTED_TO_X';
              await env.CHANGELOG_KV.put(kvKey, JSON.stringify(pendingPost));
              await sendTelegramMessage(`✅ Successfully posted changelog update (ID: ${postID}) to X!`, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
            } else {
              pendingPost.status = 'FAILED_TO_POST';
              await env.CHANGELOG_KV.put(kvKey, JSON.stringify(pendingPost));
              const failureMessage = `❌ Failed to post changelog update (ID: ${postID}) to X.\n\n*Reason:*\n\`\`\`\n${result.error || 'No specific error was provided.'}\n\`\`\``;
              await sendTelegramMessage(failureMessage, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
            }
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[${postID}] Background task failed with an exception:`, e);
            await sendTelegramMessage(`🚨 An unexpected error occurred while trying to post changelog update (ID: ${postID}).\n\n*Error:*\n\`\`\`\n${errorMessage}\n\`\`\``, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
          }
        })());
        
        const successHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Post Confirmed</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; color: #333; }
                .container { text-align: center; padding: 2rem; background-color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                h1 { font-size: 1.5rem; }
                .footer { margin-top: 2rem; font-size: 0.8rem; color: #888; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Request Received</h1>
                <p>Your request to post the update is being processed. You will receive a Telegram notification with the result shortly.</p>
              </div>
              <div class="footer">Changelog Monitor</div>
            </body>
          </html>
        `;
        return new Response(successHtml, { status: 202, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
      }
      
      return new Response('Method Not Allowed', { status: 405 });
    }

    console.log(`[${new Date().toISOString()}] Path did not match any handlers. Passing to router for 404.`);
    return router.handle(request, env, ctx);
  },
};

// ---- Helper Functions (convertToMarkdown, calculateDiff, getGeminiRecap, sendTelegramMessage) ----

async function convertToMarkdown(htmlContent: string): Promise<string> {
  console.log("Converting HTML to Markdown using NodeHtmlMarkdown...");
  try {
    const markdown = NodeHtmlMarkdown.translate(
      /* html */ htmlContent, 
      /* options */ {
        codeBlockStyle: 'fenced',
        bulletMarker: '-',
        emDelimiter: '_',
        strongDelimiter: '**',
      }
    );
    return markdown;
  } catch (e) {
    console.error("Error during markdown conversion:", e);
    // Fallback to very basic stripping if the new library fails
    const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    let potentialText = bodyMatch ? bodyMatch[1] : htmlContent;
    potentialText = potentialText.replace(/<[^>]+>/g, '');
    potentialText = potentialText.replace(/<\/(p|div|h[1-6]|li)>/gi, '\n');
    potentialText = potentialText.replace(/<br\s*\/?>/gi, '\n');
    potentialText = potentialText.replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>')
                               .replace(/&amp;/g, '&')
                               .replace(/&quot;/g, '"')
                               .replace(/&apos;/g, "'")
                               .replace(/&nbsp;/g, ' ');
    return potentialText.trim();
  }
}

// Placeholder function for diff calculation
function calculateDiff(oldText: string, newText: string): string {
  console.log("Calculating diff using jsdiff library...");
  const differences = diffLines(oldText, newText);

  let diffResult = "";
  let hasChanges = false;

  differences.forEach((part: Change) => {
    if (part.added) {
      hasChanges = true;
      diffResult += part.value.split('\n').map(line => `+ ${line}`).join('\n');
      // Ensure newline at the end of added block if original value had it
      if (part.value.endsWith('\n')) {
        if (!diffResult.endsWith('\n')) diffResult += '\n';
      } else {
        diffResult += '\n'; // Add newline for clarity if not ending with one
      }
    } else if (part.removed) {
      hasChanges = true;
      diffResult += part.value.split('\n').map(line => `- ${line}`).join('\n');
      // Ensure newline at the end of removed block
      if (part.value.endsWith('\n')) {
        if (!diffResult.endsWith('\n')) diffResult += '\n';
      } else {
        diffResult += '\n'; // Add newline for clarity if not ending with one
      }
    } else {
      // Optionally, show a bit of context for unchanged parts
      // const lines = part.value.split('\n');
      // if (lines.length > 3) {
      //   diffResult += `  ${lines[0]}\n`;
      //   diffResult += `  ... (${lines.length - 2} unchanged lines) ...\n`;
      //   diffResult += `  ${lines[lines.length -1 ]}\n`;
      // } else {
      //   diffResult += part.value.split('\n').map(line => `  ${line}`).join('\n');
      //   if (part.value.endsWith('\n')) {
      //     if (!diffResult.endsWith('\n')) diffResult += '\n';
      //   } else {
      //      diffResult += '\n';
      //   }
      // }
    }
  });

  // Trim trailing newlines that might accumulate
  diffResult = diffResult.replace(/\n+$/, "\n");

  if (!hasChanges) {
    return "No textual differences found.";
  }

  return diffResult;
}

// Gemini API call with configurable parameters
async function getGeminiRecap(diffText: string, env: Env): Promise<string | null> {
  const model = env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const prompt = `You are an expert technical writer. Summarize the following software changelog differences into a concise and engaging recap. Focus on the key changes, new features, and important fixes. Keep it brief and easy to understand for a general audience. Output only the summary text, no preamble or extra formatting.\n\nChangelog Diff:\n\`\`\`diff\n${diffText}\n\`\`\`\n\nRecap:`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: parseFloat(env.GEMINI_TEMPERATURE || '0.6'),
      topK: 1,
      topP: 0.95,
      maxOutputTokens: parseInt(env.GEMINI_MAX_TOKENS || '250'),
      stopSequences: [],
    },
    safetySettings: [ 
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  try {
    const responseData = await withRetry(
      async () => {
        const response = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json() as GeminiResponse;
      },
      RETRY_CONFIG,
      'Gemini API call'
    );

    if (responseData.candidates && responseData.candidates.length > 0 &&
        responseData.candidates[0].content && responseData.candidates[0].content.parts &&
        responseData.candidates[0].content.parts.length > 0 && responseData.candidates[0].content.parts[0].text) {
      return responseData.candidates[0].content.parts[0].text.trim();
    } else {
      console.error("Gemini API response did not contain expected text: ", responseData);
      if (responseData.promptFeedback) {
        console.error("Gemini API prompt feedback:", responseData.promptFeedback);
      }
      return null;
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return null;
  }
}

// Placeholder for Telegram API call
async function sendTelegramMessage(message: string, botToken: string, chatId: string): Promise<void> {
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${botToken}/sendMessage`;

  // Escape special characters for MarkdownV2, if using that parse_mode
  // For simplicity, using default (Markdown) or plain text. 
  // If using MarkdownV2, characters like \'_\', \'*\', \'[\', \'\\]\', \'(\', \'D\', \'~\', \'`\', \'_\', \'{\', \'}\', \'=\', \'|\', \'.\', \'!\' must be escaped.
  // const escapedMessage = message.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');

  try {
    await withRetry(
      async () => {
        const response = await fetch(TELEGRAM_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: message, // Using original message. For MarkdownV2, use escapedMessage
            // parse_mode: 'MarkdownV2' // Or 'HTML' or default Markdown
          }),
        });

        const responseData = await response.json() as TelegramResponse;
        if (!response.ok || !responseData.ok) {
          throw new Error(`Telegram API request failed: ${response.status} ${response.statusText} - ${JSON.stringify(responseData)}`);
        }
        console.log("Telegram message sent successfully.");
      },
      { ...RETRY_CONFIG, maxAttempts: 2 }, // Fewer retries for notifications
      'Telegram message send'
    );
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
}

// ---- X/Twitter Posting Implementation ----
async function postToX(
  postID: string, 
  recap: string, 
  env: Env
): Promise<{ success: boolean; error?: string }> {
  console.log(`[${postID}] Attempting to post to X/Twitter...`);
  
  // Truncate if too long (Twitter's limit is 280 characters)
  const MAX_TWEET_LENGTH = 280;
  let tweetText = recap;
  if (tweetText.length > MAX_TWEET_LENGTH) {
    tweetText = tweetText.substring(0, MAX_TWEET_LENGTH - 3) + '...';
    console.log(`[${postID}] Tweet truncated from ${recap.length} to ${tweetText.length} characters.`);
  }

  console.log(`[${postID}] Final tweet text: "${tweetText}"`);
  
  try {
    // Twitter API v2 endpoint
    const TWITTER_API_URL = 'https://api.twitter.com/2/tweets';
    
    // Prepare OAuth parameters
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID().replace(/-/g, '');
    
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: env.X_API_KEY,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: env.X_ACCESS_TOKEN,
      oauth_version: '1.0'
    };
    
    // Create signature base string
    const bodyParams = { text: tweetText };
    const signature = await createOAuth1aSignature(
      'POST',
      TWITTER_API_URL,
      oauthParams,
      bodyParams,
      env.X_API_SECRET_KEY,
      env.X_ACCESS_TOKEN_SECRET
    );
    
    oauthParams.oauth_signature = signature;
    
    // Build Authorization header
    const authHeader = 'OAuth ' + Object.entries(oauthParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
      .join(', ');
    
    const response = await withRetry(
      async () => {
        const res = await fetch(TWITTER_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyParams),
        });
        
        if (!res.ok) {
          const errorBody = await res.text();
          throw new Error(`[${postID}] Twitter API error: ${res.status} ${res.statusText} - ${errorBody}`);
        }
        
        return res;
      },
      { ...RETRY_CONFIG, maxAttempts: 2 },
      `[${postID}] X/Twitter post`
    );
    
    const responseData = await response.json() as TwitterResponse;
    
    if (responseData.data?.id) {
      console.log(`[${postID}] Successfully posted to X/Twitter. Tweet ID: ${responseData.data.id}`);
      return { success: true };
    } else {
      const errorDetails = `Unexpected Twitter API response: ${JSON.stringify(responseData)}`;
      console.error(`[${postID}] ${errorDetails}`);
      return { success: false, error: errorDetails };
    }
  } catch (error) {
    const errorDetails = `Failed to post to X/Twitter: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[${postID}] ${errorDetails}`);
    return { success: false, error: errorDetails };
  }
}

// Helper function to create OAuth 1.0a signature
async function createOAuth1aSignature(
  method: string,
  url: string,
  oauthParams: Record<string, string>,
  bodyParams: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): Promise<string> {
  // Step 1: Collect all parameters
  const allParams = { ...oauthParams };
  
  // Note: For JSON body in Twitter v2 API, we don't include body params in signature
  // This is different from form-encoded bodies in v1.1
  // bodyParams is passed for future compatibility but not used in v2 API
  void bodyParams;
  
  // Step 2: Sort parameters and encode
  const paramString = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  
  // Step 3: Create signature base string
  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString)
  ].join('&');
  
  // Step 4: Create signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  
  // Step 5: Generate HMAC-SHA1 signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const messageData = encoder.encode(signatureBase);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  
  // Step 6: Base64 encode the signature
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
} 