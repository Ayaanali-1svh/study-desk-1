'use strict';

require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const requiredEnvironment = ['DATABASE_URL', 'SESSION_SECRET'];
const missingEnvironment = requiredEnvironment.filter(name => !process.env[name]);
if (missingEnvironment.length) {
  console.error(`Missing required environment values: ${missingEnvironment.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the required values.');
  process.exit(1);
}

if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters long.');
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const isLocalDatabase = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const allowedSubjects = new Set([
  'Mathematics', 'English', 'Biology', 'Chemistry', 'Physics',
  'Individuals & Societies', 'Design', 'Arts', 'Language acquisition', 'Other'
]);

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(express.json({ limit: '150kb' }));

const PgSessionStore = connectPgSimple(session);
app.use(session({
  name: 'study_desk.sid',
  store: new PgSessionStore({
    pool,
    tableName: 'study_desk_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: isProduction ? '1h' : 0
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many account attempts. Please wait a little and try again.' }
});

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return value.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function startUserSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      req.session.userId = String(userId);
      req.session.save(saveError => saveError ? reject(saveError) : resolve());
    });
  });
}

function requireUser(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in.' });
  const result = await pool.query(
    'SELECT id, name, email FROM users WHERE id = $1',
    [req.session.userId]
  );
  if (!result.rowCount) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  res.json({ user: result.rows[0] });
}));

app.post('/api/auth/signup', authLimiter, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = normaliseEmail(req.body.email);
  const password = String(req.body.password || '');

  if (name.length < 2 || name.length > 50) {
    return res.status(400).json({ error: 'Enter a name between 2 and 50 characters.' });
  }
  if (!validEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Your password must be at least 8 characters and no longer than 72 bytes.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, passwordHash]
    );
    user = result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
    }
    throw error;
  }

  await startUserSession(req, user.id);
  res.status(201).json({ message: 'Your account has been created.', user });
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const email = normaliseEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!validEmail(email) || !password) return res.status(400).json({ error: 'Enter your email address and password.' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!result.rowCount) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const user = result.rows[0];
  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) return res.status(401).json({ error: 'Email or password is incorrect.' });

  await startUserSession(req, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (!req.session) return res.json({ message: 'Signed out.' });
  await new Promise(resolve => req.session.destroy(() => resolve()));
  res.clearCookie('study_desk.sid', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  });
  res.json({ message: 'Signed out.' });
}));

app.get('/api/workspace', requireUser, asyncRoute(async (req, res) => {
  const [assignmentResult, sessionResult] = await Promise.all([
    pool.query(
      `SELECT id, title, subject, to_char(due_date, 'YYYY-MM-DD') AS due,
       priority, completed FROM assignments WHERE user_id = $1 ORDER BY due_date, created_at`,
      [req.session.userId]
    ),
    pool.query(
      `SELECT id, topic, subject, to_char(session_date, 'YYYY-MM-DD') AS date,
       to_char(session_time, 'HH24:MI') AS time FROM study_sessions
       WHERE user_id = $1 ORDER BY session_date, session_time`,
      [req.session.userId]
    )
  ]);
  res.json({ assignments: assignmentResult.rows, sessions: sessionResult.rows });
}));

app.post('/api/assignments', requireUser, asyncRoute(async (req, res) => {
  const task = req.body || {};
  const id = String(task.id || '');
  const title = String(task.title || '').trim();
  const subject = String(task.subject || '');
  const due = String(task.due || '');
  const priority = String(task.priority || 'Normal');
  if (!id || id.length > 80 || !title || title.length > 100 || !allowedSubjects.has(subject) || !validDate(due) || !['Normal', 'Important', 'High'].includes(priority)) {
    return res.status(400).json({ error: 'Check the assignment details and try again.' });
  }
  await pool.query(
    `INSERT INTO assignments (user_id, id, title, subject, due_date, priority, completed)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
    [req.session.userId, id, title, subject, due, priority]
  );
  res.status(201).json({ message: 'Assignment saved.' });
}));

app.patch('/api/assignments/:id', requireUser, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!id || id.length > 80 || typeof req.body.completed !== 'boolean') {
    return res.status(400).json({ error: 'Invalid assignment update.' });
  }
  const result = await pool.query(
    'UPDATE assignments SET completed = $1 WHERE user_id = $2 AND id = $3',
    [req.body.completed, req.session.userId, id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Assignment not found.' });
  res.json({ message: 'Assignment updated.' });
}));

app.delete('/api/assignments/:id', requireUser, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!id || id.length > 80) return res.status(400).json({ error: 'Invalid assignment.' });
  await pool.query('DELETE FROM assignments WHERE user_id = $1 AND id = $2', [req.session.userId, id]);
  res.json({ message: 'Assignment deleted.' });
}));

app.post('/api/sessions', requireUser, asyncRoute(async (req, res) => {
  const item = req.body || {};
  const id = String(item.id || '');
  const topic = String(item.topic || '').trim();
  const subject = String(item.subject || '');
  const date = String(item.date || '');
  const time = String(item.time || '');
  if (!id || id.length > 80 || !topic || topic.length > 90 || !allowedSubjects.has(subject) || !validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return res.status(400).json({ error: 'Check the study session details and try again.' });
  }
  await pool.query(
    `INSERT INTO study_sessions (user_id, id, topic, subject, session_date, session_time)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.session.userId, id, topic, subject, date, time]
  );
  res.status(201).json({ message: 'Study session saved.' });
}));

app.delete('/api/sessions/:id', requireUser, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  if (!id || id.length > 80) return res.status(400).json({ error: 'Invalid study session.' });
  await pool.query('DELETE FROM study_sessions WHERE user_id = $1 AND id = $2', [req.session.userId, id]);
  res.json({ message: 'Study session deleted.' });
}));

app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  app.listen(port, () => console.log(`Study Desk is running on port ${port}`));
}

start().catch(error => {
  console.error('Could not start Study Desk:', error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
