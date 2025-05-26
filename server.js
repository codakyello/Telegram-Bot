// server.js
const dotenv = require("dotenv");
dotenv.config({ path: `${__dirname}/config.env` });
const app = require("./index");
const mongoose = require("mongoose");

const telegramBot = require("./bot");

// Enhanced error handling
process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! 💥 Shutting down...");
  console.log(err.name, err.message);
  console.log(err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! 💥 Shutting down...");
  console.log(err.name, err.message);
  console.log(err.stack);

  // Give time for cleanup
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Database connection with retry logic
async function connectToDatabase() {
  const DB = process.env.DATABASE?.replace(
    "<PASSWORD>",
    process.env.DATABASE_PASSWORD || ""
  );

  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(DB, {
        useUnifiedTopology: true,
        useNewUrlParser: true,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      console.log(`✅ MongoDB Connected`);
      break;
    } catch (error) {
      retries++;
      console.error(
        `❌ MongoDB connection attempt ${retries} failed: ${error.message}`
      );

      if (retries >= maxRetries) {
        console.error(
          `💀 Failed to connect to MongoDB after ${maxRetries} attempts`
        );
        process.exit(1);
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// MongoDB connection event handlers
mongoose.connection.on("connected", () => {
  console.log("📊 Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("📊 Mongoose disconnected from MongoDB");
});

mongoose.set("useFindAndModify", false);

// Server startup with proper error handling
async function startServer() {
  try {
    // Connect to database first
    await connectToDatabase();

    // Start HTTP server
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Add server error handling
    server.on("error", (error) => {
      console.error("❌ Server error:", error);
      process.exit(1);
    });

    // Start Telegram bot with retry logic
    await startTelegramBotWithRetry();

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("🛑 SIGTERM received, shutting down gracefully");
      server.close(() => {
        mongoose.connection.close(false, () => {
          console.log("✅ Server and database connections closed");
          process.exit(0);
        });
      });
    });

    process.on("SIGINT", () => {
      console.log("🛑 SIGINT received, shutting down gracefully");
      server.close(() => {
        mongoose.connection.close(false, () => {
          console.log("✅ Server and database connections closed");
          process.exit(0);
        });
      });
    });
  } catch (error) {
    console.error("💀 Failed to start server:", error);
    process.exit(1);
  }
}

async function startTelegramBotWithRetry() {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      console.log(
        `🤖 Starting Telegram bot (attempt ${retries + 1}/${maxRetries})...`
      );
      await telegramBot();
      console.log("✅ Telegram bot started successfully");
      break;
    } catch (error) {
      retries++;
      console.error(
        `❌ Telegram bot start attempt ${retries} failed:`,
        error.message
      );

      if (retries >= maxRetries) {
        console.error(
          `💀 Failed to start Telegram bot after ${maxRetries} attempts`
        );

        // Continue without bot but log the issue
        console.log("⚠️  Server will continue running without Telegram bot");
        console.log(
          "⚠️  Check your Telegram API credentials and try restarting"
        );
        return;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

// Health check endpoint
if (app && typeof app.get === "function") {
  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    });
  });
}

// Memory monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const memUsageMB = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
  };

  console.log("💾 Memory usage:", memUsageMB, "MB");

  // Alert if memory usage is high
  if (memUsageMB.heapUsed > 400) {
    console.warn("⚠️  High memory usage detected:", memUsageMB.heapUsed, "MB");
  }
}, 300000); // Every 5 minutes

// Start the server
startServer().catch((error) => {
  console.error("💀 Fatal error starting server:", error);
  process.exit(1);
});
