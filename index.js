const dotenv = require("dotenv");
const readline = require("readline");

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");

dotenv.config({ path: `${__dirname}/config.env` });

function isSignal(message) {
  const hasAction = /(?:BUY|SELL)\s+[A-Z]+/i.test(message);
  const hasEntry = /@/.test(message);
  const hasTp = /TP\d*/i.test(message);
  const hasSl = /SL/i.test(message);

  console.log(hasAction, hasEntry, hasTp, hasSl);

  return hasAction && hasEntry && hasTp && hasSl;
}

function parseSignal(message) {
  const actionMatch = message.match(/\b(BUY|SELL)\b/i);

  // Get the symbol right after BUY/SELL (e.g., BUY XAUUSD)
  const symbolMatch = message.match(/\b(?:BUY|SELL)\s+([A-Z]{3,6})\b/i);

  // Look for @ followed by number (entry price)
  const entryMatch = message.match(/@\s*([\d.]+)/);

  // TP: match TP1, TP2, TP (optional number), followed by ., :, -, or space(s)
  const tpMatches = [...message.matchAll(/TP\d*[\s:.\-]*([\d.]+)/gi)];

  // SL: same pattern
  const slMatch = message.match(/SL[\s:.\-]*([\d.]+)/i);

  return {
    action: actionMatch ? actionMatch[1].toUpperCase() : null,
    symbol: symbolMatch ? symbolMatch[1].toUpperCase() : null,
    entry: entryMatch ? entryMatch[1] : null,
    tps: tpMatches.map((tp) => tp[1]),
    sl: slMatch ? slMatch[1] : null,
  };
}

const apiId = Number(process.env.API_ID); // API ID from the .env file
const apiHash = process.env.API_HASH;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log(process.env.SESSION_STRING);
const stringSession = new StringSession(process.env.SESSION_STRING);

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: process.env.PHONE_NO,
      password: () => {
        return new Promise((resolve) => {
          rl.question("Enter your password: ", (answer) => {
            resolve(answer);
          });
        });
      },
      phoneCode: () => {
        return new Promise((resolve) => {
          rl.question("Enter your phone code: ", (answer) => {
            resolve(answer);
          });
        });
      },
      onError: (err) => console.log(err),
    });

    console.log("✅ Logged in successfully!");
    console.log(client.session.save());
  } catch (error) {
    console.error("Not Authenticated", error);
  }

  const channelsToMonitor = [
    "SniperfxGang",
    "kojoforextrades",
    "Kommonforextrades",
    "thechartwhisperersdiscussion",
    "thechartwhisperers",
  ];
  try {
    const channels = await Promise.all(
      channelsToMonitor.map((username) => client.getEntity(username))
    );
    client.addEventHandler((event) => {
      const message = event.message.message;

      console.log(message);

      console.log(isSignal(message));

      if (!isSignal(message)) return;

      console.log("Signal detected");

      const signal = parseSignal(message);

      console.log(signal);
    }, new NewMessage({ chats: channels.map((c) => c.id) }));
  } catch (error) {
    console.error("Error fetching channel:", error);
  }

  process.stdin.resume();
})();
