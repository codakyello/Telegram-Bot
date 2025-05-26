const jwt = require("jsonwebtoken");

module.exports.verifyJwt = (token) => {
  const secretKey = process.env.JWT_SECRET;

  return new Promise((resolve, reject) => {
    jwt.verify(token, secretKey, (err, decoded) => {
      if (err) {
        reject(err);
        console.log("inside reject");
        console.log(err);
      } else resolve(decoded);
    });
  });
};

module.exports.signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};
