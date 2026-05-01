import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const storePath = path.join(__dirname, 'sync-store.json');

async function readStore() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeStore(data) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'investment-dashboard-api' }));

app.get('/api/sync/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'sync code required' });
  const store = await readStore();
  const record = store[code];
  if (!record) return res.status(404).json({ error: 'not found' });
  res.json(record);
});

app.post('/api/sync/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'sync code required' });
  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload required' });
  }

  const store = await readStore();
  const record = {
    updatedAt: new Date().toISOString(),
    payload,
  };
  store[code] = record;
  await writeStore(store);
  res.json(record);
});

app.get('/api/quote', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const data = await response.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== 'number') throw new Error('price unavailable');
    res.json({ symbol, price, source: 'yahoo' });
  } catch {
    const fallback = symbol.length * 11.11;
    res.json({ symbol, price: fallback, source: 'fallback' });
  }
});

app.use(express.static(distPath));
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next();
  }
  try {
    await fs.access(path.join(distPath, 'index.html'));
    res.sendFile(path.join(distPath, 'index.html'));
  } catch {
    res.status(404).send('Build the app first with npm run build');
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`investment-dashboard-api listening on ${port}`);
});
