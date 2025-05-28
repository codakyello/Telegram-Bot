const WebSocket = require("ws");
const payloadTypes = require("./payloadTypes.json");
const fs = require("fs");
const OAModel = require("./OAModel.json");

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
            if (!this.heartbeatIntervalId) {
              this.heartbeatIntervalId = setInterval(
                () => this.sendHeartbeat(),
                HEARTBEAT_INTERVAL
              );
            }
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

  sendHeartbeat() {
    const clientMsg = {
      clientMsgId: uid(),
      payloadType: PROTO_HEARTBEAT_EVENT_PAYLOADTYPE,
      payload: {},
    };

    try {
      this.ws.send(JSON.stringify(clientMsg));
      console.log("🔁 Heartbeat sent");
    } catch (err) {
      console.error("❌ Error sending heartbeat:", err.message);
      this.scheduleReconnect();
    }
  }

  getSymbols() {
    const clientMsg = {
      clientMsgId: uid(),
      payloadType: payloadTypes.PROTO_OA_SYMBOLS_LIST_REQ,
      payload: {
        ctidTraderAccountId: this.accountIds[0],
        accessToken: this.accessToken,
        includeArchivedSymbols: false,
      },
    };

    this.ws.send(JSON.stringify(clientMsg));
  }

  onResp(message) {
    const { payloadType, payload } = message;

    switch (payloadType) {
      case payloadTypes.PROTO_OA_SYMBOLS_LIST_RES:
        fs.writeFileSync("syms.json", JSON.stringify(payload.symbol, null, 2));
        console.log("📁 Symbol list saved to syms.json");
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
    // make sure there is a secure connection

    let relativeStopLoss = CALCULATE_PRICE_DIFFERENCE({
      type: "sl",
      action: parameters.action,
      entry: parameters.entry,
      to: parameters.stopLoss,
      symbolId: parameters.symbolId,
    });

    // Adjustment for gold sells
    // if (parameters.action === 2 && parameters.symbolId === 41) {
    //   relativeStopLoss = Math.round(relativeStopLoss / 1000) * 1000;
    // }

    if (relativeStopLoss <= 0) {
      throw new Error(`Relative Stop Loss is invalid: ${relativeStopLoss}`);
    }

    let relativeTakeProfit = CALCULATE_PRICE_DIFFERENCE({
      type: "tp",
      action: parameters.action,
      entry: parameters.entry,
      to: parameters.takeProfit,
      symbolId: parameters.symbolId,
    });

    // if (parameters.action === 2 && parameters.symbolId === 41) {
    //   relativeTakeProfit = Math.round(relativeStopLoss / 1000) * 1000;
    // }

    this.accountIds.forEach((accountId) => {
      const clientMsg = {
        clientMsgId: uid(),
        payloadType: payloadTypes.PROTO_OA_NEW_ORDER_REQ,
        payload: {
          ctidTraderAccountId: accountId,
          accessToken: this.accessToken,
          orderType: parameters.orderType,
          tradeSide: parameters.action,
          symbolId: parameters.symbolId,
          volume: parameters.volume,
          relativeStopLoss,
          ...(relativeTakeProfit && { relativeTakeProfit }),
        },
      };

      console.log("📤 Placing trade...");
      this.ws.send(JSON.stringify(clientMsg));
    });
  }
}

module.exports = TradeBot;
