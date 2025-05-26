const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const { verifyJwt } = require("./jwt.js");

// Middleware to catch async errors
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next)
      .then()
      .catch((err) => {
        next(err);
      });
  };
};

// Function to send success response data
const sendSuccessResponseData = (res, dataName, data, totalCount, message) => {
  // const responseData = {};
  // responseData[dataName] = data;

  res.status(200).json({
    ...(totalCount !== undefined && totalCount !== null ? { totalCount } : {}),
    status: "success",
    message,
    results: data?.length,
    data: { [dataName]: data },
  });
};

// Function to create and send a token
const createSendToken = async (user, res) => {
  const maxAge = Number(process.env.COOKIE_EXPIRES_IN) * 24 * 60 * 60 * 1000; // Convert days to milliseconds

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  const decoded = await verifyJwt(token);

  const cookieOptions = {
    maxAge,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  // Update the User model with the timestamp of when the token was assigned
  await User.findByIdAndUpdate(user.id, {
    latestTokenAssignedAt: new Date(decoded.iat * 1000), // Convert seconds to milliseconds
  });

  // Clean the user object
  user.password = undefined;
  user.confirmPassword = undefined;
  user.tokenAssignedAt = undefined;
  user.new = undefined;
  user.passwordChangedAt = undefined;

  // Set the cookie and send the response
  res.cookie("jwt", token, cookieOptions).status(200).json({
    status: "success",
    token,
    data: {
      user,
    },
  });
};

const filterObj = function (obj, ...allowedFields) {
  const newObject = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObject[el] = obj[el];
  });
  return newObject;
};

const generateUniqueRandomNumber = (max) => {
  const uniqueNumbers = new Set(); // Use a Set to keep track of unique numbers

  return () => {
    let randomNumber;
    do {
      randomNumber = Math.floor(Math.random() * max) + 1; // Random number between 1 and numberOfRows
    } while (uniqueNumbers.has(randomNumber)); // Ensure uniqueness

    uniqueNumbers.add(randomNumber);
    const formatNumber = (randomNumber + "").padStart(3, "0");
    return formatNumber;
  };
};

module.exports = {
  generateUniqueRandomNumber,
  catchAsync,
  sendSuccessResponseData,
  createSendToken,
  filterObj,
};
