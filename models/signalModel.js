const mongoose = require("mongoose");

const signalSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ["buy", "sell"],
    lowercase: true,
    required: [true, "Action is required"],
  },
  sl: {
    type: Number,
    required: [true, "Stop Loss (sl) is required"],
  },
  tps: {
    type: [Number], // Array of numbers
    validate: {
      validator: function (arr) {
        return arr.length > 0;
      },
      message: "Take profits (tps) must be a non-empty array of numbers",
    },
    required: [true, "Take profits (tps) are required"],
  },
  symbol: {
    type: String,
    required: [true, "Symbol is required"],
    uppercase: true, // Optional: forces symbol to uppercase
  },
  entry: {
    type: Number,
    required: [true, "Entry price is required"],
  },
});

module.exports = mongoose.model("Signal", signalSchema);
