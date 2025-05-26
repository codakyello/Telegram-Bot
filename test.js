const dotenv = require("dotenv");

dotenv.config({ path: `${__dirname}/config.env` });

const startTelegramBot = require("./bot");

startTelegramBot();
