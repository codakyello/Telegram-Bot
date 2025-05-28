// bot.js
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const readline = require("readline");
const Signal = require("./models/signalModel");
const TradeBot = require("./tradeBot");
var OAModel = require("./OAModel.json");
var Symbols = require("./symbols.json");

console.log(process.env.API_ID, "API ID");
console.log(process.env.API_HASH, "API HASH");
console.log(process.env.SESSION_STRING, "SESSION STRING");
console.log(process.env.PHONE_NO, "PHONE NO");

var credentials = require("./credentials.json");

function isSignal(message) {
  const hasAction = /(?:BUY|SELL)\s+[A-Z]+/i.test(message);
  const hasEntry = /@\s*[\d.]+/i.test(message);
  const hasTp = /TP\d*[\s:.\-@]*([\d.]+|open)/i.test(message);
  const hasSl = /SL[\s:.\-@]*[\d.]+/i.test(message);
  return hasAction && hasEntry && hasSl;
}

function parseSignal(message) {
  const actionMatch = message.match(/\b(BUY|SELL)\b/i);
  const orderTypeMatch = message.match(/\b(stop|limit)\b/i);
  const symbolMatch = message.match(/\b(?:BUY|SELL)\s+([A-Z]{3,6})\b/i);
  const entryMatch = message.match(/@\s*([\d.]+)/);

  // Match TP1, TP2, TP etc. with flexible formatting and values like "open" or numbers
  const tpMatches = [...message.matchAll(/TP\d*[\s:.\-@]*([\d.]+|open)/gi)];

  const slMatch = message.match(/SL[\s:.\-@]*([\d.]+)/i);

  return {
    orderType: orderTypeMatch ? orderTypeMatch[1].toLowerCase() : "market",
    action: actionMatch ? actionMatch[1].toUpperCase() : null,
    symbol: symbolMatch ? symbolMatch[1].toUpperCase() : null,
    entry: entryMatch ? entryMatch[1] : null,
    tps: tpMatches.map((tp) => (tp[1].toLowerCase() === "open" ? null : tp[1])),
    sl: slMatch ? slMatch[1] : null,
  };
}

function getOrderType(type) {
  const orderType = type?.toLowerCase();

  if (orderType === "market") return OAModel.ProtoOAOrderType.MARKET;
  if (orderType === "limit") return OAModel.ProtoOAOrderType.LIMIT;
  if (orderType === "stop") return OAModel.ProtoOAOrderType.STOP;
}

function getDetails(symbolId) {
  switch (symbolId) {
    case 41: // Gold (XAUUSD)
      return { minVolume: 100, pipPosition: 5 };

    case 10019: // Likely an exotic pair
      return { minVolume: 5000, pipPosition: 5 };

    case 10026: // Another exotic pair
      return { minVolume: 100, pipPosition: 5 };

    default: // Default for major FX pairs
      return { minVolume: 100000, pipPosition: 5 };
  }
}

// function getAction (action) {
//   if(action.toLowerCase() === "buy") return OAModel.ProtoOATrade
// }

const tradeBot = new TradeBot(credentials);

class TelegramBotManager {
  constructor() {
    this.client = null;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.keepAliveInterval = null;
    this.healthCheckInterval = null;
    this.channels = [];
  }

  async initializeClient() {
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;
    const stringSession = new StringSession(process.env.SESSION_STRING || "");

    this.client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 10,
      retryDelay: 1000,
      autoReconnect: true,
      timeout: 30,
      useIPV6: false,
    });

    return this.client;
  }

  async authenticateClient() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      await this.client.start({
        phoneNumber: process.env.PHONE_NO,
        password: () =>
          new Promise((resolve) =>
            rl.question("Enter your password: ", (answer) => resolve(answer))
          ),
        phoneCode: () =>
          new Promise((resolve) =>
            rl.question("Enter your phone code: ", (answer) => resolve(answer))
          ),
        onError: (err) => {
          console.error("Authentication error:", err);
          this.handleConnectionError(err);
        },
      });

      console.log("✅ Logged in successfully!");
      console.log("Session String:", this.client.session.save());
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error("Failed to authenticate:", error);
      throw error;
    } finally {
      rl.close();
    }
  }

  async setupChannels() {
    const channelsToMonitor = [
      "SniperfxGang",
      "kojoforextrades",
      "Kommonforextrades",
      "thechartwhisperersdiscussion",
      "thechartwhisperers",
    ];

    try {
      this.channels = await Promise.all(
        channelsToMonitor.map(async (username) => {
          try {
            const entity = await this.client.getEntity(username);
            console.log(`✅ Connected to channel: ${username}`);
            return entity;
          } catch (error) {
            console.error(
              `❌ Failed to connect to channel ${username}:`,
              error.message
            );
            return null;
          }
        })
      );

      // Filter out null channels
      this.channels = this.channels.filter((channel) => channel !== null);

      if (this.channels.length === 0) {
        throw new Error("No channels could be connected");
      }

      console.log(`📡 Monitoring ${this.channels.length} channels`);
    } catch (error) {
      console.error("Failed to setup channels:", error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Message event handler

    this.client.addEventHandler(async (event) => {
      try {
        console.log("Trading Bot started");
      } catch (err) {
        console.log(err, "⚠️ Error starting trading Bot");
      }
      try {
        const message = event.message.message;
        console.log(`📨 Message received: ${message.substring(0, 100)}...`);

        console.log(isSignal);

        if (!isSignal(message)) return;

        const signal = parseSignal(message);

        const { orderType, action, entry, tps, sl: stopLoss, symbol } = signal;

        const matchedSymbol = Symbols.find((s) =>
          s.symbolName.find((sym) => sym.toLowerCase() === symbol.toLowerCase())
        );

        const symbolId = matchedSymbol ? matchedSymbol.symbolId : null;

        tps.forEach((tp) => {
          tradeBot
            .placeOrder({
              // limitPrice: +entry,
              entry: +entry,
              symbolId,
              volume: getDetails(symbolId).minVolume,
              stopLoss: +stopLoss,
              takeProfit: tp === "open" ? null : +tp,
              orderType: getOrderType(orderType),
              pipPosition: getDetails(symbolId).pipPosition,
              action: OAModel.ProtoOATradeSide[action.toUpperCase()],
            })
            .catch((err) =>
              console.error("❌ Failed to place order:", err.message)
            );
        });

        // send signal to db
        try {
          await Signal.create(signal);
        } catch (error) {
          console.log(error.message, "⚠️ Error saving signal to db");
        }

        // Add your signal processing logic here
      } catch (error) {
        console.error("Error processing message:", error);
      }
    }, new NewMessage({ chats: this.channels.map((c) => c.id) }));

    // Error handler for client
    this.client.on("error", (error) => {
      console.error("🚨 Client error:", error);
      this.handleConnectionError(error);
    });

    // Connection monitoring - check periodically instead of using events
    setInterval(() => {
      if (this.client && !this.client.connected && !this.isReconnecting) {
        console.log("❌ Connection lost detected, attempting to reconnect...");
        this.handleReconnection();
      }
    }, 10000); // Check every 10 seconds

    console.log("✅ Event handlers setup complete");
  }

  startKeepAlive() {
    // Keep connection alive with periodic pings
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.client && this.client.connected) {
          await this.client.invoke(
            new Api.Ping({
              pingId: BigInt(Date.now()),
            })
          );
          console.log("💓 Keep-alive ping sent");
        }
      } catch (error) {
        console.error("Keep-alive ping failed:", error);
        if (!this.isReconnecting) {
          await this.handleReconnection();
        }
      }
    }, 60000); // Every 60 seconds

    // Health check - more frequent
    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.client && this.client.connected) {
          await this.client.getMe();
          console.log("🏥 Health check passed");
        }
      } catch (error) {
        console.error("Health check failed:", error);
        if (!this.isReconnecting) {
          await this.handleReconnection();
        }
      }
    }, 30000); // Every 30 seconds

    console.log("✅ Keep-alive system started");
  }

  async handleReconnection() {
    if (this.isReconnecting) {
      console.log("⏳ Reconnection already in progress...");
      return;
    }

    this.isReconnecting = true;

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        this.reconnectAttempts++;
        console.log(
          `🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
        );

        // Disconnect first if partially connected
        try {
          await this.client.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }

        // Wait before reconnecting
        await new Promise((resolve) =>
          setTimeout(resolve, this.reconnectDelay)
        );

        // Reconnect
        await this.client.connect();

        if (this.client.connected) {
          console.log("✅ Reconnected successfully!");
          this.reconnectAttempts = 0;
          this.isReconnecting = false;

          // Re-setup channels if needed
          await this.setupChannels();
          return;
        }
      } catch (error) {
        console.error(
          `❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
          error.message
        );

        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
      }
    }

    console.error("💀 Max reconnection attempts reached. Bot will restart...");
    this.isReconnecting = false;

    // Force restart the entire process
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  }

  handleConnectionError(error) {
    console.error("🚨 Connection error:", error);

    // Don't reconnect for authentication errors
    if (error.message && error.message.includes("AUTH")) {
      console.error("💀 Authentication error - manual intervention required");
      return;
    }

    // Handle other connection errors
    if (!this.isReconnecting) {
      setTimeout(() => {
        this.handleReconnection();
      }, 2000);
    }
  }

  cleanup() {
    console.log("🧹 Cleaning up resources...");

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.client) {
      this.client.disconnect().catch(console.error);
    }
  }

  async start() {
    try {
      console.log("🚀 Starting Telegram bot...");

      await this.initializeClient();
      await this.authenticateClient();
      await this.setupChannels();

      this.setupEventHandlers();
      this.startKeepAlive();

      console.log("✅ Telegram bot started successfully!");
      console.log(
        `📡 Monitoring ${this.channels.length} channels for trading signals`
      );

      // Keep process alive
      process.stdin.resume();

      // Graceful shutdown
      process.on("SIGINT", () => {
        console.log("\n🛑 Shutting down gracefully...");
        this.cleanup();
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        console.log("\n🛑 Received SIGTERM, shutting down...");
        this.cleanup();
        process.exit(0);
      });
    } catch (error) {
      console.error("💀 Failed to start Telegram bot:", error);
      this.cleanup();
      throw error;
    }
  }
}

// Create and export the bot manager
const botManager = new TelegramBotManager();

async function startTelegramBot() {
  return await botManager.start();
}

module.exports = startTelegramBot;
