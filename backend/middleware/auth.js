// backend/middleware/authenticateJWT.js
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'your-secret-key';

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "no_token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const user = jwt.verify(token, SECRET); // { username, iat, exp }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

module.exports = authenticateJWT;
