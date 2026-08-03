const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_for_dev_only_change_in_prod';

const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        rateLimit: {
          create: {
            count: 0,
            resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
          }
        }
      }
    });

    const token = jwt.sign({ userId: user.id, tier: user.tier }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ status: 'success', token, user: { id: user.id, email: user.email, tier: user.tier } });
  } catch (error) {
    console.error('[Auth Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, tier: user.tier }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ status: 'success', token, user: { id: user.id, email: user.email, tier: user.tier } });
  } catch (error) {
    console.error('[Auth Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { register, login, prisma };
