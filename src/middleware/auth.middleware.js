const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_for_dev_only_change_in_prod';

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, tier }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const requirePremium = (req, res, next) => {
  if (req.user && (req.user.tier === 'PREMIUM' || req.user.tier === 'ADMIN')) {
    next();
  } else {
    return res.status(403).json({ error: 'Forbidden: Premium subscription required' });
  }
};

module.exports = { authenticate, requirePremium };
