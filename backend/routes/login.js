
// backend/routes/login.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'your-secret-key';

router.post('/', (req, res) => {
  const { username, password } = req.body;

  if (username === 'planner1' && password === 'mypassword') {
    const token = jwt.sign({ username }, SECRET, { expiresIn: '2h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

module.exports = router;
