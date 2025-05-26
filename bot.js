// bot.js
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const readline = require("readline");

console.log(process.env.API_ID, "API ID");
console.log(process.env.API_HASH, "API HASH");
console.log(process.env.SESSION_STRING, "SESSION STRING");
console.log(process.env.PHONE_NO, "PHONE NO");

function isSignal(message) {
  const hasAction = /(?:BUY|SELL)\s+[A-Z]+/i.test(message);
  const hasEntry = /@/.test(message);
  const hasTp = /TP\d*/i.test(message);
  const hasSl = /SL/i.test(message);
  return hasAction && hasEntry && hasTp && hasSl;
}

function parseSignal(message) {
  const actionMatch = message.match(/\b(BUY|SELL)\b/i);
  const symbolMatch = message.match(/\b(?:BUY|SELL)\s+([A-Z]{3,6})\b/i);
  const entryMatch = message.match(/@\s*([\d.]+)/);
  const tpMatches = [...message.matchAll(/TP\d*[\s:.\-]*([\d.]+)/gi)];
  const slMatch = message.match(/SL[\s:.\-]*([\d.]+)/i);

  return {
    action: actionMatch ? actionMatch[1].toUpperCase() : null,
    symbol: symbolMatch ? symbolMatch[1].toUpperCase() : null,
    entry: entryMatch ? entryMatch[1] : null,
    tps: tpMatches.map((tp) => tp[1]),
    sl: slMatch ? slMatch[1] : null,
  };
}

async function startTelegramBot() {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  const stringSession = new StringSession(process.env.SESSION_STRING || "");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: process.env.PHONE_NO,
    password: () =>
      new Promise((resolve) =>
        rl.question("Enter your password: ", (answer) => resolve(answer))
      ),
    phoneCode: () =>
      new Promise((resolve) =>
        rl.question("Enter your phone code: ", (answer) => resolve(answer))
      ),
    onError: (err) => console.log(err),
  });

  console.log("✅ Logged in successfully!");
  console.log("Session String:", client.session.save());

  const channelsToMonitor = [
    "SniperfxGang",
    "kojoforextrades",
    "Kommonforextrades",
    "thechartwhisperersdiscussion",
    "thechartwhisperers",
  ];

  const channels = await Promise.all(
    channelsToMonitor.map((username) => client.getEntity(username))
  );

  client.addEventHandler((event) => {
    const message = event.message.message;
    if (!isSignal(message)) return;

    const signal = parseSignal(message);
    console.log("Signal detected:", signal);
  }, new NewMessage({ chats: channels.map((c) => c.id) }));

  process.stdin.resume();
}

module.exports = startTelegramBot;
