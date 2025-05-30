// bot.js - Fixed version with better session management
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const readline = require("readline");
const Signal = require("./models/signalModel");
const TradeBot = require("./tradeBot");
const OAModel = require("./OAModel.json");
const accountSymbols = require("./symbols");
const credentials = require("./credentials");

// Add environment detection
const isProduction = process.env.NODE_ENV === "production";
const deploymentId = process.env.DEPLOYMENT_ID || `local-${Date.now()}`;

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

function formatSymbol(sym) {
  const symbol = sym.toLowerCase();
  if (symbol === "gold") return "XAUUSD";
  if (symbol === "oil") return "XTIUSD";
  return sym;
}

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
    this.sessionString = null;
    this.isAuthenticated = false;
  }

  async initializeClient() {
    const apiId = Number(process.env.API_ID);
    const apiHash = process.env.API_HASH;

    // Generate unique session string for production deployments
    let sessionString = process.env.SESSION_STRING || "";

    if (isProduction && !sessionString) {
      console.log(
        "🔑 Production deployment detected, generating new session..."
      );
      sessionString = ""; // Force new session creation
    }

    console.log(`🌍 Environment: ${isProduction ? "Production" : "Local"}`);
    console.log(`🆔 Deployment ID: ${deploymentId}`);

    this.sessionString = new StringSession(sessionString);

    this.client = new TelegramClient(this.sessionString, apiId, apiHash, {
      connectionRetries: 5,
      retryDelay: 2000,
      autoReconnect: true,
      timeout: 30,
      useIPV6: false,
      // Add device model to distinguish sessions
      deviceModel: `TradingBot-${deploymentId}`,
      systemVersion: "1.0.0",
      appVersion: "1.0.0",
      langCode: "en",
      systemLangCode: "en",
    });

    return this.client;
  }

  async forceLogoutExistingSessions() {
    try {
      console.log("🔄 Terminating existing sessions...");

      // Get all active sessions
      const authorizations = await this.client.invoke(
        new Api.account.GetAuthorizations()
      );

      // Terminate all other sessions except current
      for (const auth of authorizations.authorizations) {
        if (auth.current) continue;

        try {
          await this.client.invoke(
            new Api.account.ResetAuthorization({
              hash: auth.hash,
            })
          );
          console.log(`✅ Terminated session: ${auth.appName}`);
        } catch (err) {
          console.log(`⚠️ Could not terminate session: ${err.message}`);
        }
      }
    } catch (error) {
      console.log(
        "⚠️ Could not check/terminate existing sessions:",
        error.message
      );
    }
  }

  async authenticateClient() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // Check if we already have a valid session
      if (this.sessionString.session) {
        console.log("🔑 Attempting to use existing session...");
        try {
          await this.client.connect();
          const me = await this.client.getMe();
          console.log(
            `✅ Existing session valid for: ${me.firstName} ${
              me.lastName || ""
            }`
          );
          this.isAuthenticated = true;
          this.reconnectAttempts = 0;

          // Force logout other sessions in production
          if (isProduction) {
            await this.forceLogoutExistingSessions();
          }

          return;
        } catch (error) {
          console.log("❌ Existing session invalid, creating new session...");
          // Clear the invalid session
          this.sessionString = new StringSession("");
          this.client = new TelegramClient(
            this.sessionString,
            Number(process.env.API_ID),
            process.env.API_HASH,
            this.client.apiCredentials
          );
        }
      }

      // Create new session
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
      const newSessionString = this.client.session.save();
      console.log("📱 New Session String:", newSessionString);
      console.log("🔐 Save this session string to your environment variables!");

      this.isAuthenticated = true;
      this.reconnectAttempts = 0;

      // Force logout other sessions in production
      if (isProduction) {
        await this.forceLogoutExistingSessions();
      }
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
      "-1002687802563",
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
    this.client.addEventHandler(async (event) => {
      try {
        console.log("Trading Bot started");
        const message = event.message.message;
        console.log(`📨 Message received: ${message.substring(0, 100)}...`);

        if (isSignal(message)) {
          const signal = parseSignal(message);
          const {
            orderType,
            action,
            entry,
            tps,
            sl: stopLoss,
            symbol,
          } = signal;

          const symbolId = accountSymbols[credentials.accountIds[0]].find(
            (sym) =>
              sym.symbolName.toLowerCase() ===
              formatSymbol(symbol).toLowerCase()
          )?.symbolId;

          tps.forEach((tp) => {
            tradeBot
              .placeOrder({
                entry: +entry,
                symbol: formatSymbol(symbol),
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

          try {
            await Signal.create(signal);
          } catch (error) {
            console.log(error.message, "⚠️ Error saving signal to db");
          }
        }

        if (message.toLowerCase().includes("close")) {
          console.log("closing");
          tradeBot.closeTrades();
        }

        if (!isSignal(message) && /tp\s*\d+\s*hit/i.test(message)) {
          await tradeBot.modifyAccountPositions();
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    }, new NewMessage({ chats: this.channels.map((c) => c.id) }));

    this.client.on("error", (error) => {
      console.error("🚨 Client error:", error);
      this.handleConnectionError(error);
    });

    // Enhanced connection monitoring
    setInterval(async () => {
      if (this.client && !this.client.connected && !this.isReconnecting) {
        console.log("❌ Connection lost detected, attempting to reconnect...");
        await this.handleReconnection();
      }
    }, 10000);

    console.log("✅ Event handlers setup complete");
  }

  startKeepAlive() {
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
    }, 60000);

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.client && this.client.connected && this.isAuthenticated) {
          await this.client.getMe();
          console.log("🏥 Health check passed");
        }
      } catch (error) {
        console.error("Health check failed:", error);
        if (!this.isReconnecting) {
          await this.handleReconnection();
        }
      }
    }, 30000);

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

        try {
          await this.client.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }

        await new Promise((resolve) =>
          setTimeout(resolve, this.reconnectDelay)
        );

        await this.client.connect();

        if (this.client.connected) {
          console.log("✅ Reconnected successfully!");
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          await this.setupChannels();
          return;
        }
      } catch (error) {
        console.error(
          `❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
          error.message
        );
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
      }
    }

    console.error("💀 Max reconnection attempts reached. Bot will restart...");
    this.isReconnecting = false;
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  }

  handleConnectionError(error) {
    console.error("🚨 Connection error:", error);

    if (
      error.message &&
      (error.message.includes("AUTH") ||
        error.message.includes("SESSION_REVOKED") ||
        error.message.includes("AUTH_KEY_DUPLICATED"))
    ) {
      console.error(
        "💀 Authentication error - clearing session and requiring re-auth"
      );
      this.isAuthenticated = false;
      // In production, this would require manual intervention
      if (isProduction) {
        console.error("🔧 Manual session reset required in production");
        process.exit(1);
      }
      return;
    }

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

      process.stdin.resume();

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

const botManager = new TelegramBotManager();

async function startTelegramBot() {
  return await botManager.start();
}

module.exports = startTelegramBot;
