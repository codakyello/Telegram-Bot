const dotenv = require("dotenv");
dotenv.config({ path: `${__dirname}/config.env` });

const tdl = require("tdl");
const { getTdjson } = require("prebuilt-tdlib");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const readline = require("readline");
const Signal = require("./models/signalModel");
const TradeBot = require("./tradeBot");
const OAModel = require("./OAModel.json");
const accountSymbols = require("./symbols");
const credentials = require("./credentials");
const {
  formatSymbol,
  getDetails,
  getOrderType,
  parseSignal,
  isSignal,
  distributeVolumeAcrossTPs,
} = require("./helper");

tdl.configure({ tdjson: getTdjson() });

console.log(process.env.API_ID, process.env.API_HASH);

const tradeBot = new TradeBot(credentials);

const client = tdl.createClient({
  apiId: process.env.API_ID,
  apiHash: process.env.API_HASH,
  databaseDirectory: "./session", // save or load session from this folder
});
// Listen for TDLib errors
client.on("error", (err) => {
  console.error("TDLib error:", err);
});

// Listen for updates
client.on("update", async (update) => {
  if (update._ === "updateNewMessage") {
    const message = update.message.content?.text?.text;
    const chatId = update.message.chat_id;

    console.log(message, "This is the message");

    if (message) {
      console.log(`[Chat ${chatId}] Message: ${message}`);

      // You can add filters here for trade keywords like "Buy", "Sell", etc
      if (isSignal(message) && chatId === "--1001807229698") {
        const signal = parseSignal(message);

        const { orderType, action, entry, tps, sl: stopLoss, symbol } = signal;

        // const symbolId = matchedSymbol ? matchedSymbol.symbolId : null;
        // for each account place trade
        credentials.accountIds.forEach(async (accountId) => {
          const symbolId = accountSymbols[accountId].find(
            (sym) =>
              sym.symbolName.toLowerCase() ===
              formatSymbol(symbol).toLowerCase()
          )?.symbolId;

          // calculate the volume
          const totalVolume = await tradeBot.calculateVolume({
            accountId,
            entry: Number(entry),
            stopLoss: Number(stopLoss),
            symbolId,
          });
          const parameters = distributeVolumeAcrossTPs({
            tps,
            totalVolume,
            minVolume: getDetails(symbolId).minVolume,
          });

          console.log(parameters);

          // Take only Gold trades for now
          if (symbolId !== 41) return;

          parameters.forEach((parameter) => {
            tradeBot
              .placeOrder({
                entry: Number(entry),
                accountId,
                symbolId,
                volume: parameter.volume,
                stopLoss: Number(stopLoss),
                takeProfit:
                  parameter.tp === "open" ? null : Number(parameter.tp),
                orderType: getOrderType(orderType),
                pipPosition: getDetails(symbolId).pipPosition,
                action: OAModel.ProtoOATradeSide[action.toUpperCase()],
              })
              .catch((err) => {
                console.log(err, "This is the err");
                console.error("❌ Failed to place order:", err);
              });
          });
        });

        // send signal to db
        try {
          await Signal.create(signal);
        } catch (error) {
          console.log(error.message, "⚠️ Error saving signal to db");
        }
      }

      // close all trade positions
      if (message.toLowerCase().includes("close")) {
        console.log("closing");
        tradeBot.closeTrades();
      }

      // reduce sl by half on every tp
      // we will work on this one later
      if (!isSignal(message) && /tp\s*\d+\s*hit/i.test(message)) {
        await tradeBot.modifyAccountPositions();
      }

      // Add your signal processing logic here
    }
  }
});

async function main() {
  // Login with user account
  await client.login(async (auth) => {
    if (!auth?.type) return;
  });

  console.log("✅ Logged in! Listening for messages...");
}

module.exports = main;

// Simple CLI input
function ask(question) {
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve({ [question.split(" ")[1].toLowerCase()]: answer.trim() });
    });
  });
}

// // bot.js
// const { TelegramClient, Api } = require("telegram");
// const { StringSession } = require("telegram/sessions");
// const { NewMessage } = require("telegram/events");
// const readline = require("readline");
// const Signal = require("./models/signalModel");
// const TradeBot = require("./tradeBot");
// const OAModel = require("./OAModel.json");
// const accountSymbols = require("./symbols");
// const credentials = require("./credentials");
// const {
//   formatSymbol,
//   getDetails,
//   getOrderType,
//   parseSignal,
//   isSignal,
//   distributeVolumeAcrossTPs,
// } = require("./helper");

// const tradeBot = new TradeBot(credentials);

// class TelegramBotManager {
//   constructor() {
//     this.client = null;
//     this.isReconnecting = false;
//     this.reconnectAttempts = 0;
//     this.maxReconnectAttempts = 10;
//     this.reconnectDelay = 5000;
//     this.healthCheckInterval = null;
//     this.channels = [];

//     // Connection health monitoring
//     this.lastMessageTime = Date.now();
//     this.lastHealthCheck = Date.now();
//     this.healthCheckFrequency = 3 * 60 * 1000; // 3 minutes
//     this.maxSilentPeriod = 8 * 60 * 1000; // 8 minutes without any activity
//     this.isPerformingHealthCheck = false;
//   }

//   async initializeClient() {
//     const apiId = Number(process.env.API_ID);
//     const apiHash = process.env.API_HASH;
//     const stringSession = new StringSession(process.env.SESSION_STRING || "");

//     this.client = new TelegramClient(stringSession, apiId, apiHash, {
//       connectionRetries: 10,
//       retryDelay: 1000,
//       autoReconnect: true,
//       timeout: 30,
//       useIPV6: false,
//     });

//     return this.client;
//   }

//   async authenticateClient() {
//     const rl = readline.createInterface({
//       input: process.stdin,
//       output: process.stdout,
//     });

//     try {
//       await this.client.start({
//         phoneNumber: process.env.PHONE_NO,
//         password: () =>
//           new Promise((resolve) =>
//             rl.question("Enter your password: ", (answer) => resolve(answer))
//           ),
//         phoneCode: () =>
//           new Promise((resolve) =>
//             rl.question("Enter your phone code: ", (answer) => resolve(answer))
//           ),
//         onError: (err) => {
//           console.error("Authentication error:", err);
//           this.handleConnectionError(err);
//         },
//       });

//       console.log("✅ Logged in successfully!");
//       console.log("Session String:", this.client.session.save());
//       this.reconnectAttempts = 0;
//     } catch (error) {
//       console.error("Failed to authenticate:", error);
//       throw error;
//     } finally {
//       rl.close();
//     }
//   }

//   // Improved health check mechanism
//   async performHealthCheck() {
//     if (this.isPerformingHealthCheck || this.isReconnecting) {
//       return;
//     }

//     this.isPerformingHealthCheck = true;

//     try {
//       console.log("🔍 Performing connection health check...");

//       // Test connection with a lightweight API call
//       const result = await Promise.race([
//         this.client.invoke(new Api.help.GetConfig()),
//         new Promise((_, reject) =>
//           setTimeout(() => reject(new Error("Health check timeout")), 10000)
//         ),
//       ]);

//       if (result) {
//         console.log("✅ Connection health check passed");
//         this.lastHealthCheck = Date.now();
//         this.isPerformingHealthCheck = false;
//         return true;
//       }
//     } catch (error) {
//       console.error("❌ Health check failed:", error.message);
//       this.isPerformingHealthCheck = false;

//       // Connection is dead, trigger reconnection
//       console.log("🔄 Health check failed - triggering reconnection");
//       this.handleReconnection();
//       return false;
//     }

//     this.isPerformingHealthCheck = false;
//     return false;
//   }

//   startConnectionMonitoring() {
//     // Clear any existing interval
//     if (this.healthCheckInterval) {
//       clearInterval(this.healthCheckInterval);
//     }

//     this.healthCheckInterval = setInterval(async () => {
//       const now = Date.now();

//       // Check if we haven't received any messages for too long
//       const timeSinceLastMessage = now - this.lastMessageTime;
//       const timeSinceLastHealthCheck = now - this.lastHealthCheck;

//       // Perform health check if:
//       // 1. We haven't done one recently AND
//       // 2. (We haven't received messages for a while OR it's been too long since last check)
//       if (
//         timeSinceLastHealthCheck > this.healthCheckFrequency &&
//         (timeSinceLastMessage > this.maxSilentPeriod ||
//           timeSinceLastHealthCheck > this.healthCheckFrequency * 2)
//       ) {
//         console.log(`⚠️ Potential connection issue detected:`);
//         console.log(
//           `  - Time since last message: ${Math.round(
//             timeSinceLastMessage / 1000
//           )}s`
//         );
//         console.log(
//           `  - Time since last health check: ${Math.round(
//             timeSinceLastHealthCheck / 1000
//           )}s`
//         );

//         await this.performHealthCheck();
//       }

//       // Also check basic client connection status
//       if (this.client && !this.client.connected && !this.isReconnecting) {
//         console.log("❌ Client shows disconnected status");
//         this.handleReconnection();
//       }
//     }, 30000); // Check every 30 seconds

//     console.log("✅ Connection monitoring started");
//   }

//   async setupChannels() {
//     const channelsToMonitor = [
//       // "-1002687802563",
//       "-1001677088035",
//       "thechartwhisperers",
//     ];

//     try {
//       this.channels = await Promise.all(
//         channelsToMonitor.map(async (username) => {
//           try {
//             const entity = await this.client.getEntity(username);
//             console.log(`✅ Connected to channel: ${username}`);
//             return entity;
//           } catch (error) {
//             console.error(
//               `❌ Failed to connect to channel ${username}:`,
//               error.message
//             );
//             return null;
//           }
//         })
//       );

//       // Filter out null channels
//       this.channels = this.channels.filter((channel) => channel !== null);

//       if (this.channels.length === 0) {
//         throw new Error("No channels could be connected");
//       }

//       console.log(`📡 Monitoring ${this.channels.length} channels`);
//     } catch (error) {
//       console.error("Failed to setup channels:", error);
//       throw error;
//     }
//   }

//   setupEventHandlers() {
//     // Message event handler
//     this.client.addEventHandler(async (event) => {
//       try {
//         // Update last message time for health monitoring
//         this.lastMessageTime = Date.now();

//         const message = event.message.message;
//         console.log(`📨 Message received: ${message.substring(0, 100)}...`);

//         if (isSignal(message)) {
//           const signal = parseSignal(message);

//           const {
//             orderType,
//             action,
//             entry,
//             tps,
//             sl: stopLoss,
//             symbol,
//           } = signal;

//           // for each account place trade
//           credentials.accountIds.forEach(async (accountId) => {
//             const symbolId = accountSymbols[accountId].find(
//               (sym) =>
//                 sym.symbolName.toLowerCase() ===
//                 formatSymbol(symbol).toLowerCase()
//             )?.symbolId;

//             // calculate the volume
//             const totalVolume = await tradeBot.calculateVolume({
//               accountId,
//               entry: Number(entry),
//               stopLoss: Number(stopLoss),
//               symbolId,
//             });
//             const parameters = distributeVolumeAcrossTPs({
//               tps,
//               totalVolume,
//               minVolume: getDetails(symbolId).minVolume,
//             });

//             console.log(parameters);

//             // Take only Gold trades for now
//             if (symbolId !== 41) return;

//             parameters.forEach((parameter) => {
//               tradeBot
//                 .placeOrder({
//                   entry: Number(entry),
//                   accountId,
//                   symbolId,
//                   volume: parameter.volume,
//                   stopLoss: Number(stopLoss),
//                   takeProfit:
//                     parameter.tp === "open" ? null : Number(parameter.tp),
//                   orderType: getOrderType(orderType),
//                   pipPosition: getDetails(symbolId).pipPosition,
//                   action: OAModel.ProtoOATradeSide[action.toUpperCase()],
//                 })
//                 .catch((err) => {
//                   console.log(err, "This is the err");
//                   console.error("❌ Failed to place order:", err);
//                 });
//             });
//           });

//           // send signal to db
//           try {
//             await Signal.create(signal);
//           } catch (error) {
//             console.log(error.message, "⚠️ Error saving signal to db");
//           }
//         }

//         // close all trade positions
//         if (message.toLowerCase().includes("close")) {
//           console.log("closing");
//           tradeBot.closeTrades();
//         }

//         // reduce sl by half on every tp
//         if (!isSignal(message) && /tp\s*\d+\s*hit/i.test(message)) {
//           await tradeBot.modifyAccountPositions();
//         }
//       } catch (error) {
//         console.error("Error processing message:", error);
//       }
//     }, new NewMessage({ chats: this.channels.map((c) => c.id) }));

//     // Error handler for client
//     this.client.on("error", (error) => {
//       console.error("🚨 Client error:", error);
//       this.handleConnectionError(error);
//     });

//     console.log("✅ Event handlers setup complete");
//   }

//   async handleReconnection() {
//     if (this.isReconnecting) {
//       console.log("⏳ Reconnection already in progress...");
//       return;
//     }

//     this.isReconnecting = true;

//     // Stop health monitoring during reconnection
//     if (this.healthCheckInterval) {
//       clearInterval(this.healthCheckInterval);
//     }

//     while (this.reconnectAttempts < this.maxReconnectAttempts) {
//       try {
//         this.reconnectAttempts++;
//         console.log(
//           `🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
//         );

//         // Disconnect first if partially connected
//         try {
//           await this.client.disconnect();
//         } catch (e) {
//           // Ignore disconnect errors
//         }

//         // Wait before reconnecting
//         await new Promise((resolve) =>
//           setTimeout(resolve, this.reconnectDelay)
//         );

//         // Reconnect
//         await this.client.connect();

//         if (this.client.connected) {
//           console.log("✅ Reconnected successfully!");
//           this.reconnectAttempts = 0;
//           this.isReconnecting = false;

//           // Reset health monitoring timestamps
//           this.lastMessageTime = Date.now();
//           this.lastHealthCheck = Date.now();

//           // Re-setup channels if needed
//           await this.setupChannels();

//           // Restart connection monitoring
//           this.startConnectionMonitoring();
//           return;
//         }
//       } catch (error) {
//         console.error(
//           `❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
//           error.message
//         );

//         // Exponential backoff
//         this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
//       }
//     }

//     console.error("💀 Max reconnection attempts reached. Bot will restart...");
//     this.isReconnecting = false;

//     // Force restart the entire process
//     setTimeout(() => {
//       process.exit(1);
//     }, 5000);
//   }

//   handleConnectionError(error) {
//     console.error("🚨 Connection error:", error);

//     // Don't reconnect for authentication errors
//     if (error.message && error.message.includes("AUTH")) {
//       console.error("💀 Authentication error - manual intervention required");
//       return;
//     }

//     // Handle other connection errors
//     if (!this.isReconnecting) {
//       setTimeout(() => {
//         this.handleReconnection();
//       }, 2000);
//     }
//   }

//   cleanup() {
//     console.log("🧹 Cleaning up resources...");

//     if (this.healthCheckInterval) {
//       clearInterval(this.healthCheckInterval);
//     }

//     if (this.client) {
//       this.client.disconnect().catch(console.error);
//     }
//   }

//   async start() {
//     try {
//       console.log("🚀 Starting Telegram bot...");

//       await this.initializeClient();
//       await this.authenticateClient();
//       await this.setupChannels();

//       this.setupEventHandlers();

//       // Start connection monitoring instead of pinging
//       this.startConnectionMonitoring();

//       console.log("✅ Telegram bot started successfully!");
//       console.log(
//         `📡 Monitoring ${this.channels.length} channels for trading signals`
//       );

//       // Keep process alive
//       process.stdin.resume();

//       // Graceful shutdown
//       process.on("SIGINT", () => {
//         console.log("\n🛑 Shutting down gracefully...");
//         this.cleanup();
//         process.exit(0);
//       });

//       process.on("SIGTERM", () => {
//         console.log("\n🛑 Received SIGTERM, shutting down...");
//         this.cleanup();
//         process.exit(0);
//       });
//     } catch (error) {
//       console.error("💀 Failed to start Telegram bot:", error);
//       this.cleanup();
//       throw error;
//     }
//   }
// }

// // Create and export the bot manager
// const botManager = new TelegramBotManager();

// async function startTelegramBot() {
//   return await botManager.start();
// }

// module.exports = startTelegramBot;

// // // bot.js
// // const { TelegramClient, Api } = require("telegram");
// // const { StringSession } = require("telegram/sessions");
// // const { NewMessage } = require("telegram/events");
// // const readline = require("readline");
// // const Signal = require("./models/signalModel");
// // const TradeBot = require("./tradeBot");
// // const OAModel = require("./OAModel.json");
// // const accountSymbols = require("./symbols");
// // const credentials = require("./credentials");
// // const {
// //   formatSymbol,
// //   getDetails,
// //   getOrderType,
// //   parseSignal,
// //   isSignal,
// //   distributeVolumeAcrossTPs,
// //   getRandomInterval,
// // } = require("./helper");

// // // function getAction (action) {
// // //   if(action.toLowerCase() === "buy") return OAModel.ProtoOATrade
// // // }

// // const tradeBot = new TradeBot(credentials);

// // class TelegramBotManager {
// //   constructor() {
// //     this.client = null;
// //     this.isReconnecting = false;
// //     this.reconnectAttempts = 0;
// //     this.maxReconnectAttempts = 10;
// //     this.reconnectDelay = 5000;
// //     this.keepAliveInterval = null;
// //     this.healthCheckInterval = null;
// //     this.channels = [];
// //   }

// //   // "//"
// //   async initializeClient() {
// //     const apiId = Number(process.env.API_ID);
// //     const apiHash = process.env.API_HASH;
// //     const stringSession = new StringSession(process.env.SESSION_STRING || "");

// //     this.client = new TelegramClient(stringSession, apiId, apiHash, {
// //       connectionRetries: 10,
// //       retryDelay: 1000,
// //       autoReconnect: true,
// //       timeout: 30,
// //       useIPV6: false,
// //     });

// //     return this.client;
// //   }

// //   async authenticateClient() {
// //     const rl = readline.createInterface({
// //       input: process.stdin,
// //       output: process.stdout,
// //     });

// //     try {
// //       await this.client.start({
// //         phoneNumber: process.env.PHONE_NO,
// //         password: () =>
// //           new Promise((resolve) =>
// //             rl.question("Enter your password: ", (answer) => resolve(answer))
// //           ),
// //         phoneCode: () =>
// //           new Promise((resolve) =>
// //             rl.question("Enter your phone code: ", (answer) => resolve(answer))
// //           ),
// //         onError: (err) => {
// //           console.error("Authentication error:", err);
// //           this.handleConnectionError(err);
// //         },
// //       });

// //       console.log("✅ Logged in successfully!");
// //       console.log("Session String:", this.client.session.save());
// //       this.reconnectAttempts = 0;

// //       // this.sendPing(); // Start pinging
// //     } catch (error) {
// //       console.error("Failed to authenticate:", error);
// //       throw error;
// //     } finally {
// //       rl.close();
// //     }
// //   }

// //   // async sendPing() {
// //   //   try {
// //   //     const pingId = BigInt(Date.now());
// //   //     await this.client.invoke(new Api.Ping({ pingId }));
// //   //     console.log("Ping sent at", new Date().toISOString());
// //   //   } catch (err) {
// //   //     console.error("Ping failed:", err);
// //   //   }

// //   //   setTimeout(this.sendPing.bind(this), getRandomInterval()); // Random delay *after* each ping
// //   // }

// //   async setupChannels() {
// //     const channelsToMonitor = [
// //       // "-1002687802563",
// //       "-1001677088035",
// //       "thechartwhisperers",
// //     ];

// //     try {
// //       this.channels = await Promise.all(
// //         channelsToMonitor.map(async (username) => {
// //           try {
// //             const entity = await this.client.getEntity(username);
// //             console.log(`✅ Connected to channel: ${username}`);
// //             return entity;
// //           } catch (error) {
// //             console.error(
// //               `❌ Failed to connect to channel ${username}:`,
// //               error.message
// //             );
// //             return null;
// //           }
// //         })
// //       );

// //       // Filter out null channels
// //       this.channels = this.channels.filter((channel) => channel !== null);

// //       if (this.channels.length === 0) {
// //         throw new Error("No channels could be connected");
// //       }

// //       console.log(`📡 Monitoring ${this.channels.length} channels`);
// //     } catch (error) {
// //       console.error("Failed to setup channels:", error);
// //       throw error;
// //     }
// //   }

// //   setupEventHandlers() {
// //     // Message event handler

// //     this.client.addEventHandler(async (event) => {
// //       try {
// //         const message = event.message.message;
// //         console.log(`📨 Message received: ${message.substring(0, 100)}...`);

// //         // console.log(isSignal);

// //         if (isSignal(message)) {
// //           const signal = parseSignal(message);

// //           const {
// //             orderType,
// //             action,
// //             entry,
// //             tps,
// //             sl: stopLoss,
// //             symbol,
// //           } = signal;

// //           // const symbolId = matchedSymbol ? matchedSymbol.symbolId : null;
// //           // for each account place trade
// //           credentials.accountIds.forEach(async (accountId) => {
// //             const symbolId = accountSymbols[accountId].find(
// //               (sym) =>
// //                 sym.symbolName.toLowerCase() ===
// //                 formatSymbol(symbol).toLowerCase()
// //             )?.symbolId;

// //             // calculate the volume
// //             const totalVolume = await tradeBot.calculateVolume({
// //               accountId,
// //               entry: Number(entry),
// //               stopLoss: Number(stopLoss),
// //               symbolId,
// //             });
// //             const parameters = distributeVolumeAcrossTPs({
// //               tps,
// //               totalVolume,
// //               minVolume: getDetails(symbolId).minVolume,
// //             });

// //             console.log(parameters);

// //             // Take only Gold trades for now
// //             if (symbolId !== 41) return;

// //             parameters.forEach((parameter) => {
// //               tradeBot
// //                 .placeOrder({
// //                   entry: Number(entry),
// //                   accountId,
// //                   symbolId,
// //                   volume: parameter.volume,
// //                   stopLoss: Number(stopLoss),
// //                   takeProfit:
// //                     parameter.tp === "open" ? null : Number(parameter.tp),
// //                   orderType: getOrderType(orderType),
// //                   pipPosition: getDetails(symbolId).pipPosition,
// //                   action: OAModel.ProtoOATradeSide[action.toUpperCase()],
// //                 })
// //                 .catch((err) => {
// //                   console.log(err, "This is the err");
// //                   console.error("❌ Failed to place order:", err);
// //                 });
// //             });
// //           });

// //           // send signal to db
// //           try {
// //             await Signal.create(signal);
// //           } catch (error) {
// //             console.log(error.message, "⚠️ Error saving signal to db");
// //           }
// //         }

// //         // close all trade positions
// //         if (message.toLowerCase().includes("close")) {
// //           console.log("closing");
// //           tradeBot.closeTrades();
// //         }

// //         // reduce sl by half on every tp
// //         // we will work on this one later
// //         if (!isSignal(message) && /tp\s*\d+\s*hit/i.test(message)) {
// //           await tradeBot.modifyAccountPositions();
// //         }

// //         // Add your signal processing logic here
// //       } catch (error) {
// //         console.error("Error processing message:", error);
// //       }
// //     }, new NewMessage({ chats: this.channels.map((c) => c.id) }));

// //     // Error handler for client
// //     this.client.on("error", (error) => {
// //       console.error("🚨 Client error:", error);
// //       this.handleConnectionError(error);
// //     });

// //     // Connection monitoring - check periodically instead of using events
// //     setInterval(() => {
// //       if (this.client && !this.client.connected && !this.isReconnecting) {
// //         console.log("❌ Connection lost detected, attempting to reconnect...");
// //         this.handleReconnection();
// //       }
// //     }, 10000); // Check every 10 seconds

// //     console.log("✅ Event handlers setup complete");
// //   }

// //   async handleReconnection() {
// //     if (this.isReconnecting) {
// //       console.log("⏳ Reconnection already in progress...");
// //       return;
// //     }

// //     this.isReconnecting = true;

// //     while (this.reconnectAttempts < this.maxReconnectAttempts) {
// //       try {
// //         this.reconnectAttempts++;
// //         console.log(
// //           `🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
// //         );

// //         // Disconnect first if partially connected
// //         try {
// //           await this.client.disconnect();
// //         } catch (e) {
// //           // Ignore disconnect errors
// //         }

// //         // Wait before reconnecting
// //         await new Promise((resolve) =>
// //           setTimeout(resolve, this.reconnectDelay)
// //         );

// //         // Reconnect
// //         await this.client.connect();

// //         if (this.client.connected) {
// //           console.log("✅ Reconnected successfully!");
// //           this.reconnectAttempts = 0;
// //           this.isReconnecting = false;

// //           // Re-setup channels if needed
// //           await this.setupChannels();
// //           return;
// //         }
// //       } catch (error) {
// //         console.error(
// //           `❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
// //           error.message
// //         );

// //         // Exponential backoff
// //         this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
// //       }
// //     }

// //     console.error("💀 Max reconnection attempts reached. Bot will restart...");
// //     this.isReconnecting = false;

// //     // Force restart the entire process
// //     setTimeout(() => {
// //       process.exit(1);
// //     }, 5000);
// //   }

// //   handleConnectionError(error) {
// //     console.error("🚨 Connection error:", error);

// //     // Don't reconnect for authentication errors
// //     if (error.message && error.message.includes("AUTH")) {
// //       console.error("💀 Authentication error - manual intervention required");
// //       return;
// //     }

// //     // Handle other connection errors
// //     if (!this.isReconnecting) {
// //       setTimeout(() => {
// //         this.handleReconnection();
// //       }, 2000);
// //     }
// //   }

// //   cleanup() {
// //     console.log("🧹 Cleaning up resources...");

// //     if (this.keepAliveInterval) {
// //       clearInterval(this.keepAliveInterval);
// //     }

// //     if (this.healthCheckInterval) {
// //       clearInterval(this.healthCheckInterval);
// //     }

// //     if (this.client) {
// //       this.client.disconnect().catch(console.error);
// //     }
// //   }

// //   async start() {
// //     try {
// //       console.log("🚀 Starting Telegram bot...");

// //       await this.initializeClient();
// //       await this.authenticateClient();
// //       await this.setupChannels();

// //       this.setupEventHandlers();
// //       // this.startKeepAlive();

// //       console.log("✅ Telegram bot started successfully!");
// //       console.log(
// //         `📡 Monitoring ${this.channels.length} channels for trading signals`
// //       );

// //       // Keep process alive
// //       process.stdin.resume();

// //       // Graceful shutdown
// //       process.on("SIGINT", () => {
// //         console.log("\n🛑 Shutting down gracefully...");
// //         this.cleanup();
// //         process.exit(0);
// //       });

// //       process.on("SIGTERM", () => {
// //         console.log("\n🛑 Received SIGTERM, shutting down...");
// //         this.cleanup();
// //         process.exit(0);
// //       });
// //     } catch (error) {
// //       console.error("💀 Failed to start Telegram bot:", error);
// //       this.cleanup();
// //       throw error;
// //     }
// //   }
// // }

// // // Create and export the bot manager
// // const botManager = new TelegramBotManager();

// // async function startTelegramBot() {
// //   return await botManager.start();
// // }

// // module.exports = startTelegramBot;
