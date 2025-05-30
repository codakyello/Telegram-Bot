const WebSocket = require("ws");
const payloadTypes = require("./payloadTypes.json");
const fs = require("fs");
const OAModel = require("./OAModel.json");
const accountSymbols = require("./symbols");

const PROTO_HEARTBEAT_EVENT_PAYLOADTYPE = 51;

const uid = (
  (i) => () =>
    "cm_id_" + i++
)(1);

function CALCULATE_PRICE_DIFFERENCE({
  type,
  entry,
  to,
  action,
  pipPosition = 5,
  symbolId,
}) {
  let priceDifference;

  if ((action === 1 && type === "sl") || (action === 2 && type === "tp")) {
    priceDifference = Math.round((entry - to) * 10 ** pipPosition);
  } else {
    priceDifference = Math.round((to - entry) * 10 ** pipPosition);
  }

  // modify gold positions
  if (action === 2 && symbolId === 41) {
    priceDifference = Math.round(priceDifference / 1000) * 1000;
  }

  return to ? priceDifference : null;
}

const HEARTBEAT_INTERVAL = 15000; // 15 seconds
const RECONNECT_DELAY = 5000; // delay in ms before reconnect attempt

class TradeBot {
  constructor(credentials) {
    this.credentials = credentials;
    this.accountIds = credentials.accountIds;
    this.accessToken = credentials.accessToken;

    this.ws = null;
    this.heartbeatIntervalId = null;
    this.reconnectTimeout = null;
    this.connected = false;

    this.openConnection();
  }

  openConnection() {
    return new Promise((resolve, _) => {
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws = null;
      }

      this.ws = new WebSocket("wss://demo.ctraderapi.com:5036");

      this.ws.onopen = () => {
        console.log("✅ WebSocket connection established.");

        const clientMsg = {
          clientMsgId: uid(),
          payloadType: payloadTypes.PROTO_OA_APPLICATION_AUTH_REQ,
          payload: {
            clientId: this.credentials.clientId,
            clientSecret: this.credentials.clientSecret,
          },
        };

        this.ws.send(JSON.stringify(clientMsg));
      };

      // subscribe this callback
      this.ws.onmessage = (e) => {
        try {
          const serverMsg = JSON.parse(e.data);
          const { payloadType } = serverMsg;

          if (payloadType === payloadTypes.PROTO_OA_APPLICATION_AUTH_RES) {
            console.log("🔐 Application Auth successful");
            this.authenticateAccount();
          } else if (payloadType === payloadTypes.PROTO_OA_ACCOUNT_AUTH_RES) {
            console.log("🔓 Account Auth successful");
            this.connected = true;
            this.getSymbols();

            resolve();
            // if (!this.heartbeatIntervalId) {
            //   this.heartbeatIntervalId = setInterval(
            //     () => this.sendHeartbeat(),
            //     HEARTBEAT_INTERVAL
            //   );
            // }
          } else if (payloadType === payloadTypes.PROTO_OA_ERROR_RES) {
            console.error("❌ API Error:", serverMsg.payload);
          } else if (payloadType === PROTO_HEARTBEAT_EVENT_PAYLOADTYPE) {
            console.log("💓 Heartbeat received");
          } else {
            this.onResp(serverMsg);
          }
        } catch (err) {
          console.error("❌ Failed to process message:", e.data, err.message);
        }
      };

      this.ws.onerror = (e) => {
        console.error("❌ WebSocket error:", e.message || e);
        this.scheduleReconnect();
      };

      this.ws.onclose = (e) => {
        console.warn(
          "⚠️ WebSocket closed:",
          e.code,
          e.reason || "",
          e.wasClean
        );
        this.connected = false;
        clearInterval(this.heartbeatIntervalId);
        this.heartbeatIntervalId = null;
        this.scheduleReconnect();
      };
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;

    console.log(
      `🔄 Attempting reconnect in ${RECONNECT_DELAY / 1000} seconds...`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.openConnection();
    }, RECONNECT_DELAY);
  }

  authenticateAccount() {
    this.accountIds.forEach((accountId) => {
      const clientMsg = {
        clientMsgId: uid(),
        payloadType: payloadTypes.PROTO_OA_ACCOUNT_AUTH_REQ,
        payload: {
          ctidTraderAccountId: accountId,
          accessToken: this.accessToken,
        },
      };
      this.ws.send(JSON.stringify(clientMsg));
    });
  }

  // sendHeartbeat() {
  //   const clientMsg = {
  //     clientMsgId: uid(),
  //     payloadType: PROTO_HEARTBEAT_EVENT_PAYLOADTYPE,
  //     payload: {},
  //   };

  //   try {
  //     this.ws.send(JSON.stringify(clientMsg));
  //     console.log("🔁 Heartbeat sent");
  //   } catch (err) {
  //     console.error("❌ Error sending heartbeat:", err.message);
  //     this.scheduleReconnect();
  //   }
  // }

  getSymbols() {
    this.accountIds.forEach((accountId) => {
      console.log(accountId);
      const msgId = uid();
      const clientMsg = {
        clientMsgId: msgId,
        payloadType: payloadTypes.PROTO_OA_SYMBOLS_LIST_REQ,
        payload: {
          ctidTraderAccountId: accountId,
          accessToken: this.accessToken,
          includeArchivedSymbols: false,
        },
      };

      const handler = (message) => {
        const parsed = JSON.parse(message.data);

        // Ignore unrelated messages
        if (parsed.clientMsgId !== msgId) return;

        // Now we know this is the response we care about
        this.ws.removeEventListener("message", handler);

        if (parsed.payloadType === payloadTypes.PROTO_OA_SYMBOLS_LIST_RES) {
          fs.writeFileSync(
            `syms-${accountId}.json`,
            JSON.stringify(parsed.payload.symbol, null, 2)
          );
          accountSymbols[accountId] = parsed.payload.symbol;

          console.log(`📁 Symbol list saved to syms-${accountId}.json`);
        } else if (parsed.payloadType === payloadTypes.PROTO_OA_ERROR_RES) {
          console.error(
            `❌ Failed to save symbols for ${accountId}:`,
            parsed.payload
          );
        }
      };

      this.ws.send(JSON.stringify(clientMsg));

      this.ws.addEventListener("message", handler);
    });

    // this.ws.send(JSON.stringify(clientMsg));
  }

  onResp(message) {
    const { payloadType, payload } = message;

    switch (payloadType) {
      case payloadTypes.PROTO_OA_SYMBOLS_LIST_RES:
        // console.log("📁 Symbol list saved");
        break;

      case payloadTypes.PROTO_OA_EXECUTION_EVENT:
        console.log("✅ Order executed");
        console.log("Order ID:", payload.order.orderId);
        console.log("Position ID:", payload.order.positionId);
        break;

      case payloadTypes.PROTO_OA_SPOT_EVENT:
        console.log("⚠️ Spot Event - check order status");
        console.log("Order ID:", payload.order.orderId);
        break;

      case payloadTypes.PROTO_OA_ORDER_ERROR_EVENT:
        console.error("❌ Order Error Event:", payload);
        break;

      default:
        console.log("📨 Unhandled message type:", payloadType);
    }
  }

  async placeOrder(parameters) {
    const clientMsgId = uid();

    console.log("placing trades");
    const orderPromises = this.accountIds.map((accountId) => {
      // different accounts have different account symbols
      // show we have to find the symbold id for each accountId
      const symbolId = accountSymbols[accountId].find(
        (symbol) =>
          symbol.symbolName.toLowerCase() === parameters.symbol.toLowerCase()
      )?.symbolId;

      let relativeStopLoss = CALCULATE_PRICE_DIFFERENCE({
        type: "sl",
        action: parameters.action,
        entry: parameters.entry,
        to: parameters.stopLoss,
        symbolId,
      });

      if (relativeStopLoss <= 0) {
        throw new Error(`Relative Stop Loss is invalid: ${relativeStopLoss}`);
      }

      let relativeTakeProfit = CALCULATE_PRICE_DIFFERENCE({
        type: "tp",
        action: parameters.action,
        entry: parameters.entry,
        to: parameters.takeProfit,
        symbolId,
      });

      return new Promise((resolve, reject) => {
        const msgId = uid();

        console.log(accountId, parameters, symbolId);
        const clientMsg = {
          clientMsgId: msgId,
          payloadType: payloadTypes.PROTO_OA_NEW_ORDER_REQ,
          payload: {
            ctidTraderAccountId: accountId,
            accessToken: this.accessToken,
            orderType: parameters.orderType,
            tradeSide: parameters.action,
            symbolId,
            volume: parameters.volume,
            relativeStopLoss,
            ...(relativeTakeProfit && { relativeTakeProfit }),
          },
        };

        const responseHandler = (message) => {
          const parsed = JSON.parse(message.data);

          if (parsed.clientMsgId !== msgId) return;

          this.ws.removeEventListener("message", responseHandler);

          if (parsed.payloadType === payloadTypes.PROTO_OA_ERROR_RES) {
            reject(`❌ Account ${accountId}: ${parsed.payload.errorMessage}`);
          } else if (
            parsed.payloadType === payloadTypes.PROTO_OA_EXECUTION_EVENT
          ) {
            resolve(`✅ Account ${accountId}: Trade executed`);
            console.log("Trade executed successfully");
          } else {
            reject(`❌ Account ${accountId}: Unexpected response`);
            console.log("Failed to open trade", parsed.payload);
          }
        };

        this.ws.addEventListener("message", responseHandler);
        console.log(`📤 Sending trade for account ${accountId}...`);
        this.ws.send(JSON.stringify(clientMsg));
      });
    });

    const results = await Promise.allSettled(orderPromises);

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        console.log(result.value);
      } else {
        throw new Error(result.reason);
      }
    });

    return results;
  }

  async closeTrades() {
    const allClosePromises = [];

    for (const accountId of this.accountIds) {
      try {
        const positions = await this.getOpenPositions(accountId);

        positions.forEach((position) => {
          const clientMsgId = uid(); // Unique for each position

          const closePromise = new Promise((resolve, reject) => {
            const listener = (event) => {
              try {
                const serverMsg = JSON.parse(event.data);

                if (serverMsg.clientMsgId !== clientMsgId) return;

                this.ws.removeEventListener("message", listener);

                if (
                  serverMsg.payloadType ===
                  payloadTypes.PROTO_OA_CLOSE_POSITION_RES
                ) {
                  console.log(
                    `✅ Closed position ${position.positionId} on account ${accountId}`
                  );
                  resolve(serverMsg.payload);
                }

                if (serverMsg.payloadType === payloadTypes.PROTO_OA_ERROR_RES) {
                  console.error(
                    `❌ Failed to close position ${position.positionId} on account ${accountId}:`,
                    serverMsg.payload.errorMessage
                  );
                  reject(new Error(serverMsg.payload.errorMessage));
                }
              } catch (err) {
                this.ws.removeEventListener("message", listener);
                reject(err);
              }
            };

            this.ws.addEventListener("message", listener);

            // Send the close request
            this.ws.send(
              JSON.stringify({
                clientMsgId,
                payloadType: payloadTypes.PROTO_OA_CLOSE_POSITION_REQ,
                payload: {
                  ctidTraderAccountId: accountId,
                  positionId: position.positionId,
                  volume: position.tradeData.volume,
                },
              })
            );
          });

          allClosePromises.push(closePromise);
        });
      } catch (err) {
        console.error(
          `❌ Failed to get positions for account ${accountId}:`,
          err
        );
      }
    }

    // Wait for all close attempts to settle (resolve or reject)
    const results = await Promise.allSettled(allClosePromises);

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        console.log(`✅ Trade ${index + 1} closed successfully`);
      } else {
        console.error(`❌ Trade ${index + 1} failed to close:`, result.reason);
      }
    });

    return results;
  }

  async getOpenPositions(accountId) {
    const msgId = uid();
    return new Promise((resolve) => {
      this.ws.send(
        JSON.stringify({
          clientMsgId: msgId,
          payloadType: payloadTypes.PROTO_OA_RECONCILE_REQ,

          payload: {
            ctidTraderAccountId: accountId,
          },
        })
      );

      const reponsponseHandler = (event) => {
        const serverMsg = JSON.parse(event.data);

        if (serverMsg.clientMsgId !== msgId) return;

        this.ws.removeEventListener("message", reponsponseHandler);

        if (serverMsg.payloadType === payloadTypes.PROTO_OA_RECONCILE_RES) {
          const positions = serverMsg.payload.position || [];
          resolve(positions);
        }
      };

      this.ws.addEventListener("message", reponsponseHandler);
    });
  }

  async modifyPosition({ positionId, accountId, payload }) {
    return new Promise((resolve, reject) => {
      const clientMsgId = uid();

      this.ws.send(
        JSON.stringify({
          clientMsgId,
          payloadType: payloadTypes.PROTO_OA_AMEND_POSITION_SLTP_REQ,

          payload: { ...payload, positionId, ctidTraderAccountId: accountId },
        })
      );

      const handler = (event) => {
        try {
          const serverMsg = JSON.parse(event.data);

          if (serverMsg.clientMsgId !== clientMsgId) return;

          this.ws.removeEventListener("message", handler);

          if (serverMsg.payloadType === payloadTypes.PROTO_OA_EXECUTION_EVENT) {
            console.log("Tp hit. Reduced Sl by 50%");
            resolve(serverMsg.payload);
          }

          if (serverMsg.payloadType === payloadTypes.PROTO_OA_ERROR_RES) {
            console.error(
              `❌ Failed to modify position ${positionId} on account ${accountId}:`,
              serverMsg.payload.errorMessage
            );
            reject(new Error(serverMsg.payload.errorMessage));
          }
        } catch (err) {
          this.ws.removeEventListener("message", handler);
          reject(err);
        }
      };

      this.ws.addEventListener("message", handler);
    });
  }

  async modifyAccountPositions() {
    for (const accountId of this.accountIds) {
      const positions = await this.getOpenPositions(accountId);
      console.log(positions.length);

      for (const position of positions) {
        const {
          positionId,
          stopLoss,
          price: openPrice,
          tradeData,
          takeProfit,
        } = position;

        if (!stopLoss) {
          console.log(`⚠️ Position ${positionId} has no SL set. Skipping.`);
          continue;
        }

        const tradeSide = tradeData.tradeSide;
        let newStopLoss;

        if (tradeSide === 1) {
          // BUY: SL is below entry
          newStopLoss = openPrice - (openPrice - stopLoss) / 2;
        } else if (tradeSide === 2) {
          // SELL: SL is above entry
          newStopLoss = openPrice + (stopLoss - openPrice) / 2;
        } else {
          console.warn(`❌ Unknown trade side for position ${positionId}`);
          continue;
        }

        // Round to match moneyDigits (2)
        newStopLoss = parseFloat(newStopLoss.toFixed(position.moneyDigits));

        console.log(
          `➡️ Modifying SL for position ${positionId} from ${stopLoss} ➡️ ${newStopLoss}`
        );

        try {
          this.modifyPosition({
            positionId,
            accountId,
            payload: { stopLoss: newStopLoss, takeProfit },
          });
        } catch (err) {
          console.error(
            `❌ Failed to modify SL for position ${positionId}`,
            err
          );
        }
      }
    }
  }
}

module.exports = TradeBot;
