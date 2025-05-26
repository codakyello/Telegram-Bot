const dotenv = require("dotenv");
const express = require("express");

const app = express();

dotenv.config({ path: `${__dirname}/config.env` });

const startTelegramBot = require("./bot");

// Server Port
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startTelegramBot().catch((err) => {
    console.error("Telegram bot failed to start", err);
  });
});
// startTelegramBot();
