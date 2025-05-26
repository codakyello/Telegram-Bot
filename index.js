// app.js
const express = require("express");
const cors = require("cors");
const globalErrorHandler = require("./controllers/errorController");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const mongoSanitize = require("express-mongo-sanitize");
const helmet = require("helmet");
const hpp = require("hpp");
const AppError = require("./utils/appError");

// Routes
const signalRoutes = require("./routes/signalRoutes");
const app = express();

app.use(cors());
app.use(helmet());
app.use(cookieParser());
app.use(express.json());
app.use(bodyParser.json({ limit: "10kb" }));
app.use(mongoSanitize());
app.use(hpp({ whitelist: [] }));
app.use(express.static(`${__dirname}/public`));

// Routes

app.use("/api/v1/signals", signalRoutes);
app.get("/", (_req, res) => {
  res.send("<h1>Deployment Check</h1>");
});

app.use("*", (req, _res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
