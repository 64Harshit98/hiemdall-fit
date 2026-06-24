import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import 'dotenv/config';

import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import plansRouter from './routes/plans.js';
import logsRouter from './routes/logs.js';
import reportsRouter from './routes/reports.js';
import adminRouter from './routes/admin.js';
import { startWeeklyCron } from './services/cron.js';

// Fail fast on an unset/default JWT secret: with admin impersonation live, a
// forged token signed with the well-known default is a full account-takeover
// vector. Hard-stop in production; warn loudly in dev.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me') {
  const msg = 'JWT_SECRET is unset or set to the insecure default. Set a long random value (e.g. `openssl rand -hex 32`).';
  if (process.env.NODE_ENV === 'production') {
    console.error(`[fatal] ${msg}`);
    process.exit(1);
  }
  console.warn(`[warn] ${msg}`);
}

const app = express();

app.use(cors({
  origin: true,           // reflect request origin; we're behind VPN/LAN only
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/plans', plansRouter);
app.use('/api/logs', logsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const port = process.env.PORT || 3001;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on :${port}`);
  startWeeklyCron();
});
