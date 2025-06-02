const OAModel = require("./OAModel.json");

function isSignal(message) {
  const hasAction = /(?:BUY|SELL)\s+[A-Z]+/i.test(message);
  const hasEntry = /@\s*[\d.]+/i.test(message);
  // const hasTp = /TP\d*[\s:.\-@]*([\d.]+|open)/i.test(message);
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

// same symbolId for pairs listed in the function, it is okay here
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

function getRandomInterval() {
  const Intervals = [60, 90, 80, 120, 70, 100];

  return Intervals[Math.floor(Math.random() * Intervals.length)] * 1000;
}

const roundToNearestHundredth = (num) => Math.round(num * 100) / 100;

function roundSmart(volume) {
  const hundreds = Math.floor(volume / 100) * 100;
  const remainder = volume % 100;
  const firstDigit = Math.floor(remainder / 10);

  if (firstDigit >= 5) return hundreds + 100; // *50+ → round up
  return hundreds; // *40- → round down
}

function distributeVolumeAcrossTPs({ tps, totalVolume, minVolume }) {
  const tpCount = tps.length;

  if (totalVolume < minVolume) {
    throw new Error(
      "Total volume is too low to meet minimum volume requirement."
    );
  }

  // Step 1: Smart round totalVolume
  totalVolume = roundSmart(totalVolume);

  // Step 2: Raw volume per TP (before rounding)
  let rawVolumePerTP = totalVolume / tpCount;

  // Step 3: Round down each volume to nearest minVolume
  let volumes = Array(tpCount).fill(0);
  let totalAssigned = 0;

  for (let i = 0; i < tpCount; i++) {
    volumes[i] = Math.floor(rawVolumePerTP / minVolume) * minVolume;
    totalAssigned += volumes[i];
  }

  // Step 4: Distribute leftover by adding minVolume to TPs from start
  let leftover = totalVolume - totalAssigned;
  for (let i = 0; i < tpCount && leftover >= minVolume; i++) {
    volumes[i] += minVolume;
    leftover -= minVolume;
  }

  // Step 5: Map TPs to volumes, exclude below-min
  return tps
    .map((tp, i) => ({ tp, volume: volumes[i] }))
    .filter((t) => t.volume >= minVolume);
}

module.exports = {
  formatSymbol,
  getDetails,
  getOrderType,
  parseSignal,
  isSignal,
  roundToNearestHundredth,
  distributeVolumeAcrossTPs,
  getRandomInterval,
};
