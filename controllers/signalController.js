const Signal = require("../models/signalModel");
const { catchAsync, sendSuccessResponseData } = require("../utils/helpers");
module.exports.createSignal = catchAsync(async (req, res) => {
  const newSignal = await Signal.create(req.body);

  sendSuccessResponseData(res, "signal", newSignal);
});

module.exports.getLatestSignal = catchAsync((req, res) => {});
