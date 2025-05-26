const express = require("express");
const router = express.Router();
const {
  createSignal,
  getLatestSignal,
} = require("../controllers/signalController");

router.route("/").post(createSignal);

router.get("/latest-signal", getLatestSignal);

module.exports = router;
