// // server.js
// const dotenv = require("dotenv");
// const app = require("./index");
// // const startTelegramBot = require("./bot");
// const mongoose = require("mongoose");

// process.on("uncaughtException", (err) => {
//   console.log("UNCAUGHT EXCEPTION! 💥 Shutting down...");
//   console.log(err.name, err.message);
//   process.exit(1);
// });

// dotenv.config({ path: `${__dirname}/config.env` });

// const DB = process.env.DATABASE?.replace(
//   "<PASSWORD>",
//   process.env.DATABASE_PASSWORD || ""
// );

// mongoose
//   .connect(DB, { useUnifiedTopology: true, useNewUrlParser: true })
//   .then(() => {
//     console.log(`MongoDB Connected`);
//   })
//   .catch((error) => {
//     console.error(`Error: ${error.message}`);
//     process.exit(1);
//   });
// mongoose.set("useFindAndModify", false);

// // Server Port
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`);
//   //   startTelegramBot().catch((err) => {
//   //     console.error("Telegram bot failed to start", err);
//   //   });
// });

// process.on("unhandledRejection", (err) => {
//   console.log("UNHANDLED REJECTION! 💥 Shutting down...");
//   console.log(err.name, err.message);
//   server.close(() => {
//     process.exit(1);
//   });
// });

const dotenv = require("dotenv");

dotenv.config({ path: `${__dirname}/config.env` });

const startTelegramBot = require("./bot");

startTelegramBot();
