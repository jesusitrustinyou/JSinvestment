import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  calculatePortfolioTotals,
  formatMoney,
  parseCurrencyValue,
  type PortfolioHolding,
  type PortfolioHoldingWithTotals,
} from './portfolio';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type RangeKey = '1Y' | '3Y' | '5Y' | 'ALL';
type AccountCategory = 'IRA-1' | 'IRA-2' | 'ROTH' | 'Brokerage';

type AllocationItem = { label: string; percent: number; color: string };
type ManualHoldingInput = { ticker: string; assetClass: string; account: AccountCategory; shares: string; costBasisPerShare: string };
type DraftMap = Record<AccountCategory, ManualHoldingInput>;
type QuoteMap = Record<AccountCategory, QuoteState>;
type LoadingMap = Record<AccountCategory, boolean>;
type ErrorMap = Record<AccountCategory, string>;
type BalanceSheet = { homeValue: string; cashAccounts: string; cryptoAssets: string; otherAssets: string; liabilities: string };
type QuoteState = { symbol: string; price: number; source: string } | null;
type EditTarget = { section: 'base' | 'manual'; index: number } | null;
type CloudSyncPayload = {
  version: 1;
  baseHoldings: PortfolioHolding[];
  manualHoldings: PortfolioHolding[];
  balanceSheet: BalanceSheet;
  selectedRange: RangeKey;
};
type CloudSyncEnvelope = {
  encrypted: true;
  salt: string;
  iv: string;
  ciphertext: string;
};

type CloudSyncBody = CloudSyncPayload | CloudSyncEnvelope;

type CloudSyncRecord = {
  updatedAt: string;
  payload: CloudSyncBody;
};

const rangeLabels: { key: RangeKey; label: string }[] = [
  { key: '1Y', label: '1Y' },
  { key: '3Y', label: '3Y' },
  { key: '5Y', label: '5Y' },
  { key: 'ALL', label: 'All' },
];

const accountCategories: AccountCategory[] = ['IRA-1', 'IRA-2', 'ROTH', 'Brokerage'];

const STORAGE_KEYS = {
  baseHoldings: 'js-investments.baseHoldings.v2',
  manualHoldings: 'js-investments.manualHoldings.v2',
  balanceSheet: 'js-investments.balanceSheet.v2',
  selectedRange: 'js-investments.selectedRange.v2',
  syncCode: 'js-investments.syncCode.v2',
};

const baseHoldingsSeed = [
  { ticker: 'VTI', assetClass: 'Core Equity ETF', account: 'Brokerage', marketValue: '$0', costBasis: '$0', income12m: '$0' },
  { ticker: 'BND', assetClass: 'Bond ETF', account: 'IRA-1', marketValue: '$0', costBasis: '$0', income12m: '$0' },
  { ticker: 'VXUS', assetClass: 'International Equity ETF', account: 'IRA-2', marketValue: '$0', costBasis: '$0', income12m: '$0' },
  { ticker: 'SCHD', assetClass: 'Dividend ETF', account: 'ROTH', marketValue: '$0', costBasis: '$0', income12m: '$0' },
  { ticker: 'BTC', assetClass: 'Crypto', account: 'Brokerage', marketValue: '$0', costBasis: '$0', income12m: '$0' },
  { ticker: 'CASH', assetClass: 'Cash Equivalent', account: 'Brokerage', marketValue: '$0', costBasis: '$0', income12m: '$0' },
];


const defaultBalanceSheet: BalanceSheet = {
  homeValue: '0',
  cashAccounts: '0',
  cryptoAssets: '0',
  otherAssets: '0',
  liabilities: '0',
};

const seriesByRange: Record<RangeKey, number[]> = {
  '1Y': [100, 102, 101, 104, 103, 107, 112, 110, 116, 121, 126, 131],
  '3Y': [100, 103, 106, 108, 112, 115, 119, 123, 128, 131, 135, 139],
  '5Y': [100, 104, 108, 112, 118, 123, 129, 135, 141, 147, 154, 159],
  ALL: [100, 105, 109, 114, 121, 129, 138, 146, 154, 163, 171, 183],
};

const allocationPalette = ['#60a5fa', '#22c55e', '#f59e0b', '#a78bfa', '#f43f5e', '#14b8a6', '#eab308', '#38bdf8'];
const allocationBucketRules: Array<{ match: RegExp; label: string; color: string }> = [
  { match: /cash|money market|mmf|t-bill|treasury bill|ultra short/i, label: 'Cash & Cash Equivalents', color: '#60a5fa' },
  { match: /treasur|gov|government/i, label: 'Treasuries & Government', color: '#22c55e' },
  { match: /bond|fixed income|credit|corporate/i, label: 'Bond Funds / Credit', color: '#f59e0b' },
  { match: /cd|certificate/i, label: 'CDs', color: '#a78bfa' },
  { match: /preferred/i, label: 'Preferreds', color: '#f43f5e' },
  { match: /equity|stock|etf|index|spy|qqq|soxx/i, label: 'Equities / ETFs', color: '#14b8a6' },
];

function loadStoredValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeAccount(account?: string): AccountCategory {
  return accountCategories.includes(account as AccountCategory) ? (account as AccountCategory) : 'Brokerage';
}

function emptyDraft(account: AccountCategory): ManualHoldingInput {
  return { ticker: '', assetClass: '', account, shares: '', costBasisPerShare: '' };
}

function createEmptyDraftMap(): DraftMap {
  return Object.fromEntries(accountCategories.map((account) => [account, emptyDraft(account)])) as DraftMap;
}

function toPortfolioHolding(row: { ticker: string; assetClass: string; account?: string; marketValue: string; costBasis: string; income12m: string }): PortfolioHolding {
  return {
    ticker: row.ticker,
    assetClass: row.assetClass,
    account: normalizeAccount(row.account),
    marketValue: parseCurrencyValue(row.marketValue),
    costBasis: parseCurrencyValue(row.costBasis),
    income12m: parseCurrencyValue(row.income12m),
  };
}

function loadStoredHoldings(key: string, fallback: PortfolioHolding[]) {
  const loaded = loadStoredValue<PortfolioHolding[]>(key, fallback);
  return Array.isArray(loaded)
    ? loaded
        .filter((holding) => holding && typeof holding.ticker === 'string' && typeof holding.assetClass === 'string')
        .map((holding) => ({ ...holding, account: normalizeAccount(holding.account) }))
    : fallback;
}

function loadStoredRange(key: string, fallback: RangeKey) {
  const loaded = loadStoredValue<RangeKey>(key, fallback);
  return ['1Y', '3Y', '5Y', 'ALL'].includes(loaded) ? loaded : fallback;
}

function loadStoredBalanceSheet(key: string, fallback: BalanceSheet) {
  const loaded = loadStoredValue<Partial<BalanceSheet>>(key, fallback);
  return {
    homeValue: String(loaded.homeValue ?? fallback.homeValue),
    cashAccounts: String(loaded.cashAccounts ?? fallback.cashAccounts),
    cryptoAssets: String(loaded.cryptoAssets ?? fallback.cryptoAssets),
    otherAssets: String(loaded.otherAssets ?? fallback.otherAssets),
    liabilities: String(loaded.liabilities ?? fallback.liabilities),
  };
}

function buildHoldingFromDraft(draft: ManualHoldingInput, forcedAccount?: AccountCategory, liveQuote?: QuoteState): PortfolioHolding | null {
  const ticker = draft.ticker.trim().toUpperCase();
  const shares = Number(draft.shares);
  const costBasisPerShare = Number(draft.costBasisPerShare);
  if (!ticker || !Number.isFinite(shares) || !Number.isFinite(costBasisPerShare) || shares <= 0) return null;
  const currentPrice = liveQuote?.symbol === ticker ? liveQuote.price : costBasisPerShare;
  return {
    ticker,
    assetClass: draft.assetClass.trim() || 'Other',
    account: normalizeAccount(forcedAccount ?? draft.account),
    shares,
    currentPrice,
    marketValue: shares * currentPrice,
    costBasis: costBasisPerShare,
    income12m: 0,
  };
}

function formatLine(series: number[]) {
  const width = 720;
  const height = 320;
  const padding = 24;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const step = (width - padding * 2) / (series.length - 1);
  const points = series.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;
  const last = points[points.length - 1];
  const current = series[series.length - 1];
  const start = series[0];
  const change = (((current / start) * 100) - 100).toFixed(1);
  return { line, area, last, current, start, change };
}

function bucketForHolding(holding: PortfolioHoldingWithTotals) {
  const source = `${holding.assetClass ?? ''} ${holding.ticker ?? ''}`.trim();
  for (const rule of allocationBucketRules) {
    if (rule.match.test(source)) return rule;
  }
  return { label: holding.assetClass?.trim() || 'Other', color: allocationPalette[0] };
}

function buildAllocationFromHoldings(holdings: PortfolioHoldingWithTotals[]): AllocationItem[] {
  const grouped = new Map<string, AllocationItem & { value: number }>();
  let paletteIndex = 0;
  for (const holding of holdings) {
    const bucket = bucketForHolding(holding);
    const key = bucket.label.toLowerCase();
    const current = grouped.get(key);
    const color = bucket.color ?? allocationPalette[paletteIndex % allocationPalette.length];
    if (!current) {
      grouped.set(key, { label: bucket.label, percent: 0, color, value: holding.marketValue });
      if (!bucket.color) paletteIndex += 1;
    } else {
      current.value += holding.marketValue;
    }
  }
  const total = Array.from(grouped.values()).reduce((sum, item) => sum + item.value, 0);
  return Array.from(grouped.values())
    .map((item) => ({ label: item.label, color: item.color, percent: total > 0 ? (item.value / total) * 100 : 0 }))
    .sort((a, b) => b.percent - a.percent);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function generateSyncCode() {
  return `jsi-${crypto.randomUUID().slice(0, 8)}`;
}

async function copyText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
}

async function deriveEncryptionKey(passphrase: string, salt: ArrayBuffer) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptSyncPayload(payload: CloudSyncPayload, passphrase: string): Promise<CloudSyncEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(
    passphrase,
    salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    encrypted: true,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptSyncPayload(envelope: CloudSyncEnvelope, passphrase: string): Promise<CloudSyncPayload> {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await deriveEncryptionKey(
    passphrase,
    salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
  );
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted)) as CloudSyncPayload;
}

async function fetchLiveQuote(symbol: string) {
  const clean = symbol.trim().toUpperCase();
  const response = await fetch(`${API_BASE_URL}/api/quote?symbol=${encodeURIComponent(clean)}`);
  if (!response.ok) throw new Error(`Quote lookup failed (${response.status})`);
  return response.json() as Promise<{ symbol: string; price: number; source: string }>;
}

export default function App() {
  const [selectedRange, setSelectedRange] = useState<RangeKey>(() => loadStoredRange(STORAGE_KEYS.selectedRange, '1Y'));
  const [baseHoldings, setBaseHoldings] = useState<PortfolioHolding[]>(() =>
    loadStoredHoldings(STORAGE_KEYS.baseHoldings, baseHoldingsSeed.map(toPortfolioHolding)),
  );
  const [manualHoldings, setManualHoldings] = useState<PortfolioHolding[]>(() =>
    loadStoredHoldings(STORAGE_KEYS.manualHoldings, []),
  );
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet>(() =>
    loadStoredBalanceSheet(STORAGE_KEYS.balanceSheet, defaultBalanceSheet),
  );
  const [draft, setDraft] = useState<ManualHoldingInput>({ ticker: '', assetClass: '', account: 'Brokerage', shares: '', costBasisPerShare: '' });
  const [draftsByAccount, setDraftsByAccount] = useState<DraftMap>(() => createEmptyDraftMap());
  const [accountQuotes, setAccountQuotes] = useState<QuoteMap>(() => Object.fromEntries(accountCategories.map((account) => [account, null])) as QuoteMap);
  const [accountQuoteLoading, setAccountQuoteLoading] = useState<LoadingMap>(() => Object.fromEntries(accountCategories.map((account) => [account, false])) as LoadingMap);
  const [, setAccountQuoteError] = useState<ErrorMap>(() => Object.fromEntries(accountCategories.map((account) => [account, ''])) as ErrorMap);
  const [editingTarget, setEditingTarget] = useState<EditTarget>(null);
  const [syncCode, setSyncCode] = useState(() => loadStoredValue(STORAGE_KEYS.syncCode, ''));
  const [syncPassphrase, setSyncPassphrase] = useState('');
  const [syncStatus, setSyncStatus] = useState('Not connected');
  const [quote, setQuote] = useState<QuoteState>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  const series = seriesByRange[selectedRange];
  const chart = useMemo(() => formatLine(series), [series]);
  const allHoldings = useMemo(
    () => [...baseHoldings, ...manualHoldings].sort((a, b) => {
      const accountDiff = accountCategories.indexOf(normalizeAccount(a.account)) - accountCategories.indexOf(normalizeAccount(b.account));
      if (accountDiff !== 0) return accountDiff;
      return a.ticker.localeCompare(b.ticker);
    }),
    [baseHoldings, manualHoldings],
  );
  const totals = useMemo(() => calculatePortfolioTotals(allHoldings), [allHoldings]);
  const allocation = useMemo(() => buildAllocationFromHoldings(totals.holdings), [totals.holdings]);
  const accountSummaries = useMemo(
    () => accountCategories.map((account) => {
      const holdings = totals.holdings.filter((holding) => normalizeAccount(holding.account) === account);
      const marketValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
      return { account, holdings, marketValue, count: holdings.length };
    }),
    [totals.holdings],
  );
  const income12m = allHoldings.reduce((sum, h) => sum + (h.income12m ?? 0), 0);

  const homeValue = parseCurrencyValue(balanceSheet.homeValue);
  const cashAccounts = parseCurrencyValue(balanceSheet.cashAccounts);
  const cryptoAssets = parseCurrencyValue(balanceSheet.cryptoAssets);
  const otherAssets = parseCurrencyValue(balanceSheet.otherAssets);
  const liabilities = parseCurrencyValue(balanceSheet.liabilities);
  const totalAssets = totals.totalMarketValue + homeValue + cashAccounts + cryptoAssets + otherAssets;
  const netWorth = totalAssets - liabilities;
  const totalValue = formatMoney(totals.totalMarketValue);
  const totalNetWorth = formatMoney(netWorth);
  const totalAssetsLabel = formatMoney(totalAssets);
  const totalLiabilitiesLabel = formatMoney(liabilities);
  const totalUnrealized = formatMoney(totals.unrealizedGainLoss);
  const returnPct = totals.totalCostBasis > 0 ? (totals.unrealizedGainLoss / totals.totalCostBasis) * 100 : 0;

  const saveStoredValue = <T,>(key: string, value: T) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(value));
  };

  useEffect(() => { saveStoredValue(STORAGE_KEYS.baseHoldings, baseHoldings); }, [baseHoldings]);
  useEffect(() => { saveStoredValue(STORAGE_KEYS.manualHoldings, manualHoldings); }, [manualHoldings]);
  useEffect(() => { saveStoredValue(STORAGE_KEYS.selectedRange, selectedRange); }, [selectedRange]);
  useEffect(() => { saveStoredValue(STORAGE_KEYS.balanceSheet, balanceSheet); }, [balanceSheet]);
  useEffect(() => { saveStoredValue(STORAGE_KEYS.syncCode, syncCode); }, [syncCode]);

  useEffect(() => {
    const timers = accountCategories.map((account) => {
      const ticker = draftsByAccount[account].ticker.trim().toUpperCase();
      if (!ticker) {
        setAccountQuotes((current) => ({ ...current, [account]: null }));
        setAccountQuoteLoading((current) => ({ ...current, [account]: false }));
        setAccountQuoteError((current) => ({ ...current, [account]: '' }));
        return null;
      }
      return window.setTimeout(() => {
        setAccountQuoteLoading((current) => ({ ...current, [account]: true }));
        setAccountQuoteError((current) => ({ ...current, [account]: '' }));
        void fetchLiveQuote(ticker)
          .then((result) => {
            setAccountQuotes((current) => ({ ...current, [account]: result }));
          })
          .catch((error) => {
            setAccountQuotes((current) => ({ ...current, [account]: null }));
            setAccountQuoteError((current) => ({
              ...current,
              [account]: error instanceof Error ? error.message : 'Quote lookup failed',
            }));
          })
          .finally(() => {
            setAccountQuoteLoading((current) => ({ ...current, [account]: false }));
          });
      }, 300);
    });

    return () => {
      timers.forEach((timer) => {
        if (timer !== null) window.clearTimeout(timer);
      });
    };
  }, [draftsByAccount]);

  const generateAndCopySyncCode = async () => {
    const code = generateSyncCode();
    setSyncCode(code);
    try {
      await copyText(code);
      setSyncStatus(`Generated and copied ${code}`);
    } catch {
      setSyncStatus(`Generated ${code}`);
    }
  };

  const buildCloudPayload = (): CloudSyncPayload => ({
    version: 1,
    baseHoldings,
    manualHoldings,
    balanceSheet,
    selectedRange,
  });

  const loadCloudState = async () => {
    const code = syncCode.trim();
    const passphrase = syncPassphrase.trim();
    if (!code) {
      setSyncStatus('Enter a sync code to load or save');
      return;
    }
    if (!passphrase) {
      setSyncStatus('Enter the encryption passphrase to load encrypted sync');
      return;
    }

    setSyncStatus('Loading encrypted sync…');
    try {
      const response = await fetch(`${API_BASE_URL}/api/sync/${encodeURIComponent(code)}`);
      if (!response.ok) {
        throw new Error(`Cloud record not found (${response.status})`);
      }
      const record = (await response.json()) as CloudSyncRecord;
      const payload = 'encrypted' in record.payload
        ? await decryptSyncPayload(record.payload, passphrase)
        : record.payload;
      setBaseHoldings(payload.baseHoldings ?? []);
      setManualHoldings(payload.manualHoldings ?? []);
      setBalanceSheet(payload.balanceSheet ?? defaultBalanceSheet);
      setSelectedRange(payload.selectedRange ?? '1Y');
      setSyncStatus(`Loaded encrypted sync at ${new Date(record.updatedAt).toLocaleString()}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Encrypted cloud load failed');
    }
  };

  const saveCloudState = async () => {
    const code = syncCode.trim();
    const passphrase = syncPassphrase.trim();
    if (!code) {
      setSyncStatus('Enter a sync code to save');
      return;
    }
    if (!passphrase) {
      setSyncStatus('Enter the encryption passphrase to save encrypted sync');
      return;
    }

    setSyncStatus('Saving encrypted sync…');
    try {
      const encryptedPayload = await encryptSyncPayload(buildCloudPayload(), passphrase);
      const response = await fetch(`${API_BASE_URL}/api/sync/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encryptedPayload),
      });
      if (!response.ok) {
        throw new Error(`Cloud save failed (${response.status})`);
      }
      const record = (await response.json()) as CloudSyncRecord;
      setSyncStatus(`Saved encrypted sync at ${new Date(record.updatedAt).toLocaleString()}`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Encrypted cloud save failed');
    }
  };

  useEffect(() => {
    if (!syncCode.trim() || !syncPassphrase.trim()) return;
    void loadCloudState();
  }, [syncCode, syncPassphrase]);

  useEffect(() => {
    const code = syncCode.trim();
    const passphrase = syncPassphrase.trim();
    if (!code || !passphrase) return;
    const timer = window.setTimeout(() => {
      void saveCloudState();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [baseHoldings, manualHoldings, balanceSheet, selectedRange, syncCode, syncPassphrase]);

  const saveEditedHolding = () => {
    if (!editingTarget) return;
    const ticker = draft.ticker.trim().toUpperCase();
    const shares = Number(draft.shares);
    const costBasisPerShare = Number(draft.costBasisPerShare);
    if (!ticker || !Number.isFinite(shares) || !Number.isFinite(costBasisPerShare) || shares <= 0) return;
    const currentPrice = quote?.symbol === ticker ? quote.price : costBasisPerShare;
    const updatedHolding: PortfolioHolding = {
      ticker,
      assetClass: draft.assetClass.trim() || 'Other',
      account: draft.account,
      shares,
      currentPrice,
      costBasis: costBasisPerShare,
      marketValue: shares * currentPrice,
      income12m: 0,
    };

    if (editingTarget.section === 'base') {
      setBaseHoldings((current) => current.map((holding, index) => (index === editingTarget.index ? updatedHolding : holding)));
    } else {
      setManualHoldings((current) => current.map((holding, index) => (index === editingTarget.index ? updatedHolding : holding)));
    }

    setEditingTarget(null);
    setDraft({ ticker: '', assetClass: '', account: 'Brokerage', shares: '', costBasisPerShare: '' });
    setQuote(null);
    setQuoteError('');
  };

  const startEditHolding = (holding: PortfolioHolding, section: 'base' | 'manual', index: number) => {
    setEditingTarget({ section, index });
    setDraft({
      ticker: holding.ticker,
      assetClass: holding.assetClass,
      account: normalizeAccount(holding.account),
      shares: String(holding.shares ?? 0),
      costBasisPerShare: String(holding.costBasis ?? 0),
    });
    setQuote(null);
    setQuoteError('');
  };

  const cancelEdit = () => {
    setEditingTarget(null);
    setDraft({ ticker: '', assetClass: '', account: 'Brokerage', shares: '', costBasisPerShare: '' });
    setQuote(null);
    setQuoteError('');
  };

  const resetPortfolio = () => {
    setBaseHoldings(baseHoldingsSeed.map(toPortfolioHolding));
    setManualHoldings([]);
    setBalanceSheet(defaultBalanceSheet);
    setSelectedRange('1Y');
    setEditingTarget(null);
    setDraft({ ticker: '', assetClass: '', account: 'Brokerage', shares: '', costBasisPerShare: '' });
    setDraftsByAccount(createEmptyDraftMap());
    setAccountQuotes(Object.fromEntries(accountCategories.map((account) => [account, null])) as QuoteMap);
    setAccountQuoteLoading(Object.fromEntries(accountCategories.map((account) => [account, false])) as LoadingMap);
    setAccountQuoteError(Object.fromEntries(accountCategories.map((account) => [account, ''])) as ErrorMap);
    setQuote(null);
    setQuoteError('');
  };

  const removeBaseHolding = (indexToRemove: number) => setBaseHoldings((current) => current.filter((_, index) => index !== indexToRemove));
  const removeManualHolding = (indexToRemove: number) => setManualHoldings((current) => current.filter((_, index) => index !== indexToRemove));

  const setDraftForAccount = (account: AccountCategory, updater: (draft: ManualHoldingInput) => ManualHoldingInput) => {
    setDraftsByAccount((current) => ({ ...current, [account]: updater(current[account]) }));
  };

  const clearAccountDraft = (account: AccountCategory) => {
    setDraftsByAccount((current) => ({ ...current, [account]: emptyDraft(account) }));
    setAccountQuotes((current) => ({ ...current, [account]: null }));
    setAccountQuoteLoading((current) => ({ ...current, [account]: false }));
    setAccountQuoteError((current) => ({ ...current, [account]: '' }));
  };

  const lookupPriceForAccount = async (account: AccountCategory) => {
    const ticker = draftsByAccount[account].ticker.trim().toUpperCase();
    if (!ticker) return;
    setAccountQuoteLoading((current) => ({ ...current, [account]: true }));
    setAccountQuoteError((current) => ({ ...current, [account]: '' }));
    try {
      const result = await fetchLiveQuote(ticker);
      setAccountQuotes((current) => ({ ...current, [account]: result }));
    } catch (error) {
      setAccountQuotes((current) => ({ ...current, [account]: null }));
      setAccountQuoteError((current) => ({
        ...current,
        [account]: error instanceof Error ? error.message : 'Quote lookup failed',
      }));
    } finally {
      setAccountQuoteLoading((current) => ({ ...current, [account]: false }));
    }
  };

  const addHoldingForAccount = (account: AccountCategory) => {
    const holding = buildHoldingFromDraft(draftsByAccount[account], account, accountQuotes[account]);
    if (!holding) return;
    setManualHoldings((current) => [...current, holding]);
    clearAccountDraft(account);
  };

  const lookupPrice = async () => {
    const ticker = draft.ticker.trim().toUpperCase();
    if (!ticker) return;
    setQuoteLoading(true);
    setQuoteError('');
    try {
      setQuote(await fetchLiveQuote(ticker));
    } catch (error) {
      setQuote(null);
      setQuoteError(error instanceof Error ? error.message : 'Quote lookup failed');
    } finally {
      setQuoteLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
          <div>
            <div className="eyebrow">JSInvestments</div>
            <h1>JSInvestments</h1>
            <p className="subtitle">Track investments, home equity, cash accounts, crypto, liabilities, and net worth in one place.</p>
          </div>
        <div className="controls">
          <button className="control-chip" type="button" onClick={resetPortfolio}>Reset portfolio</button>
          <div className="range-group" aria-label="time range selector">
            {rangeLabels.map((range) => (
              <button key={range.key} className={range.key === selectedRange ? 'range-btn active' : 'range-btn'} onClick={() => setSelectedRange(range.key)} type="button">{range.label}</button>
            ))}
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Encrypted Cloud Sync</h2>
            <p>Use the same sync code and encryption passphrase on your phone and computer to keep the portfolio data in sync.</p>
          </div>
        </div>
        <div className="entry-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label>
            <span>Sync code</span>
            <input value={syncCode} onChange={(e) => setSyncCode(e.target.value)} placeholder="your-private-sync-code" />
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button className="control-chip" type="button" onClick={generateAndCopySyncCode}>Generate sync code</button>
              <button className="control-chip" type="button" onClick={async () => { if (syncCode.trim()) { try { await copyText(syncCode.trim()); setSyncStatus(`Copied ${syncCode.trim()}`); } catch { setSyncStatus('Copy failed'); } } }}>
                Copy code
              </button>
            </div>
          </label>
          <label>
            <span>Encryption passphrase</span>
            <input type="password" value={syncPassphrase} onChange={(e) => setSyncPassphrase(e.target.value)} placeholder="private password" />
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <div className="row-actions">
              <button className="control-chip" type="button" onClick={loadCloudState}>Load from cloud</button>
              <button className="control-chip" type="button" onClick={saveCloudState}>Save to cloud</button>
            </div>
          </div>
        </div>
        <div className="small-muted" style={{ marginTop: 10 }}>
          {syncStatus} — encrypted before it leaves your browser.
        </div>
      </section>

      <section className="kpi-grid" aria-label="summary metrics">
        {[
          ['Total Net Worth', totalNetWorth, 'Assets minus liabilities'],
          ['Total Assets', totalAssetsLabel, 'Investments + home + cash + other assets'],
          ['Total Liabilities', totalLiabilitiesLabel, 'Debt and other obligations'],
          ['Portfolio Value', totalValue, 'Tracked investment holdings'],
          ['Unrealized Gain/Loss', totalUnrealized, 'Current vs cost basis'],
          ['Total Return %', `${returnPct.toFixed(2)}%`, 'Portfolio level return'],
          ['Trailing 12M Income', formatMoney(income12m), 'Income from current holdings'],
        ].map(([label, value, sub]) => (
          <article className="kpi-card" key={label}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value as string}</div>
            <div className="kpi-sub">{sub as string}</div>
          </article>
        ))}
      </section>

      <section className="main-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Performance</h2>
              <p>Portfolio value over time</p>
            </div>
            <span className="panel-badge">Selected range: {selectedRange}</span>
          </div>
          <svg viewBox="0 0 720 320" className="performance-chart" role="img" aria-label="Performance line chart">
            {[18, 32, 46, 60, 74].map((y) => <line key={y} x1="24" x2="696" y1={y * 4} y2={y * 4} className="grid-line" />)}
            <polygon points={chart.area} fill="rgba(34,197,94,0.08)" />
            <polyline points={chart.line} className="chart-line" />
            <circle cx={chart.last[0]} cy={chart.last[1]} r="5" className="chart-dot" />
          </svg>
          <div className="chart-footer small-muted">Start: {chart.start} • End: {chart.current} • Change: +{chart.change}%</div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Allocation by Asset Class</h2>
              <p>Automatically calculated from current holdings</p>
            </div>
            <span className="panel-badge">Auto-updated</span>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{ background: `conic-gradient(${allocation.map((item, index) => {
              const start = allocation.slice(0, index).reduce((sum, slice) => sum + slice.percent, 0);
              const end = start + item.percent;
              return `${item.color} ${start}% ${end}%`;
            }).join(', ')})` }}>
              <div className="donut-center">
                <div className="donut-value">{allocation.length ? `${allocation[0].percent.toFixed(0)}%` : '—'}</div>
                <div className="small-muted">Largest sleeve</div>
              </div>
            </div>
          </div>
          <div className="allocation-list">
            {allocation.map((item) => (
              <div className="allocation-row" key={item.label}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="legend-dot" style={{ background: item.color }} />{item.label}</div>
                <div className="allocation-bar"><div className="allocation-fill" style={{ width: `${item.percent}%`, background: item.color }} /></div>
                <div className="allocation-percent">{item.percent.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Balance Sheet</h2>
            <p>Enter home value, cash accounts, crypto, other assets, and liabilities to calculate true net worth.</p>
          </div>
        </div>
        <div className="balance-grid">
          <label><span>Home Value</span><input value={balanceSheet.homeValue} onChange={(e) => setBalanceSheet({ ...balanceSheet, homeValue: e.target.value })} placeholder="350000" /></label>
          <label><span>Cash Accounts</span><input value={balanceSheet.cashAccounts} onChange={(e) => setBalanceSheet({ ...balanceSheet, cashAccounts: e.target.value })} placeholder="50000" /></label>
          <label><span>Crypto Assets</span><input value={balanceSheet.cryptoAssets} onChange={(e) => setBalanceSheet({ ...balanceSheet, cryptoAssets: e.target.value })} placeholder="15000" /></label>
          <label><span>Other Assets</span><input value={balanceSheet.otherAssets} onChange={(e) => setBalanceSheet({ ...balanceSheet, otherAssets: e.target.value })} placeholder="25000" /></label>
          <label><span>Liabilities / Debt</span><input value={balanceSheet.liabilities} onChange={(e) => setBalanceSheet({ ...balanceSheet, liabilities: e.target.value })} placeholder="180000" /></label>
        </div>
        <div className="summary-grid" style={{ marginTop: 16 }}>
          <div className="summary-card"><div className="kpi-label">Total Assets</div><div className="value">{totalAssetsLabel}</div></div>
          <div className="summary-card"><div className="kpi-label">Total Liabilities</div><div className="value">{totalLiabilitiesLabel}</div></div>
          <div className="summary-card"><div className="kpi-label">Net Worth</div><div className="value">{totalNetWorth}</div></div>
        </div>
      </section>

      {editingTarget ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Edit Holding</h2>
              <p>Update the selected holding, then save the changes.</p>
            </div>
            <div className="row-actions">
              <button className="control-chip" type="button" onClick={lookupPrice} disabled={quoteLoading}>{quoteLoading ? 'Looking up…' : 'Lookup live price'}</button>
              <button className="control-chip" type="button" onClick={saveEditedHolding}>Save changes</button>
              <button className="control-chip" type="button" onClick={cancelEdit}>Cancel edit</button>
            </div>
          </div>
          <div className="entry-grid">
            <label><span>Account</span><select value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value as AccountCategory })}>{accountCategories.map((account) => <option key={account} value={account}>{account}</option>)}</select></label>
            <label><span>Ticker</span><input value={draft.ticker} onChange={(e) => setDraft({ ...draft, ticker: e.target.value })} placeholder="SOXX" /></label>
            <label><span>Asset Class</span><input value={draft.assetClass} onChange={(e) => setDraft({ ...draft, assetClass: e.target.value })} placeholder="ETF" /></label>
            <label><span>Shares</span><input value={draft.shares} onChange={(e) => setDraft({ ...draft, shares: e.target.value })} placeholder="100" /></label>
            <label><span>Cost Basis / Share</span><input value={draft.costBasisPerShare} onChange={(e) => setDraft({ ...draft, costBasisPerShare: e.target.value })} placeholder="450.00" /></label>
          </div>
          <div className="quote-strip">
            <div><strong>Live quote:</strong> {quote ? `${quote.symbol} ${formatMoney(quote.price)} (${quote.source})` : 'None yet'}</div>
            <div><strong>Lookup status:</strong> {quoteError || 'Ready'}</div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Holdings</h2>
            <p>Market value, cost basis, and unrealized gain/loss recalculate as prices change.</p>
          </div>
        </div>
        <div className="account-groups">
          {accountSummaries.map((summary) => {
            const draftForAccount = draftsByAccount[summary.account];
            const quoteForAccount = accountQuotes[summary.account];
            const holdings = summary.holdings;
            const costBasisTotal = holdings.reduce((sum, holding) => sum + holding.costValue, 0);
            const gainTotal = holdings.reduce((sum, holding) => sum + holding.unrealizedGainLoss, 0);
            const pctOfNetWorth = netWorth > 0 ? (summary.marketValue / netWorth) * 100 : 0;
            const holdingLabel = summary.count === 1 ? '1 holding' : `${summary.count} holdings`;
            return (
              <section className="account-group" key={summary.account}>
                <div className="account-group-head">
                  <div>
                    <h3>{summary.account}</h3>
                    <p>{holdingLabel}</p>
                  </div>
                  <div className="account-group-stats">
                    <div><span>{formatMoney(summary.marketValue)}</span><small>Total dollar amount</small></div>
                    <div><span>{formatMoney(costBasisTotal)}</span><small>Cost basis</small></div>
                    <div><span className={gainTotal >= 0 ? 'tone-green' : 'tone-red'}>{formatMoney(gainTotal)}</span><small>Unrealized G/L</small></div>
                    <div><span>{pctOfNetWorth.toFixed(2)}%</span><small>% of net worth</small></div>
                  </div>
                </div>

                <div className="account-mini-form">
                  <div className="account-mini-form-title">Add directly to {summary.account}</div>
                  <div className="account-mini-grid">
                    <input value={draftForAccount.ticker} onChange={(e) => setDraftForAccount(summary.account, (current) => ({ ...current, ticker: e.target.value }))} placeholder="Ticker" />
                    <input value={draftForAccount.assetClass} onChange={(e) => setDraftForAccount(summary.account, (current) => ({ ...current, assetClass: e.target.value }))} placeholder="Asset class" />
                    <input value={draftForAccount.shares} onChange={(e) => setDraftForAccount(summary.account, (current) => ({ ...current, shares: e.target.value }))} placeholder="Shares" />
                    <input value={draftForAccount.costBasisPerShare} onChange={(e) => setDraftForAccount(summary.account, (current) => ({ ...current, costBasisPerShare: e.target.value }))} placeholder="Cost basis/share" />
                  </div>
                  <div className="mini-live-row">
                    <span>Live price</span>
                    <strong>{quoteForAccount ? `${quoteForAccount.symbol} ${formatMoney(quoteForAccount.price)} (${quoteForAccount.source})` : 'Typing a ticker loads the live quote automatically'}</strong>
                  </div>
                  <div className="row-actions account-mini-actions">
                    <button className="control-chip" type="button" onClick={() => lookupPriceForAccount(summary.account)} disabled={accountQuoteLoading[summary.account]}>
                      Refresh live price
                    </button>
                    <button className="control-chip" type="button" onClick={() => addHoldingForAccount(summary.account)}>
                      Add to {summary.account}
                    </button>
                    <button className="control-chip" type="button" onClick={() => clearAccountDraft(summary.account)}>
                      Clear
                    </button>
                  </div>
                </div>

                <div className="table-scroll" style={{ marginTop: 14 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Asset Class</th>
                        <th>Shares</th>
                        <th>Current Price</th>
                        <th>Market Value</th>
                        <th>Cost Basis</th>
                        <th>Unrealized G/L</th>
                        <th>Weight</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.length ? holdings.map((holding) => {
                        const baseIndex = allHoldings.findIndex((item) => item.ticker === holding.ticker && normalizeAccount(item.account) === summary.account && item.marketValue === holding.marketValue);
                        const currentPrice = holding.currentPrice ?? (holding.marketValue ?? 0);
                        return (
                          <tr key={`${summary.account}-${holding.ticker}-${holding.marketValue}`}>
                            <td>{holding.ticker}</td>
                            <td>{holding.assetClass}</td>
                            <td>{holding.shares ?? '—'}</td>
                            <td>{formatMoney(currentPrice)}</td>
                            <td>{formatMoney(holding.marketValue)}</td>
                            <td>{formatMoney(holding.costValue)}</td>
                            <td className={holding.unrealizedGainLoss >= 0 ? 'tone-green' : 'tone-red'}>{formatMoney(holding.unrealizedGainLoss)}</td>
                            <td>{holding.portfolioPct.toFixed(2)}%</td>
                            <td>
                              <div className="row-actions">
                                <button className="row-action" type="button" onClick={() => startEditHolding(holding, baseIndex >= baseHoldings.length ? 'manual' : 'base', baseIndex >= baseHoldings.length ? baseIndex - baseHoldings.length : baseIndex)}>
                                  Edit
                                </button>
                                <button className="row-action" type="button" onClick={() => {
                                  const currentIndex = allHoldings.findIndex((item) => item.ticker === holding.ticker && normalizeAccount(item.account) === summary.account && item.marketValue === holding.marketValue);
                                  const isManual = currentIndex >= baseHoldings.length;
                                  if (isManual) {
                                    removeManualHolding(currentIndex - baseHoldings.length);
                                  } else {
                                    removeBaseHolding(currentIndex);
                                  }
                                }}>
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr><td className="empty-state" colSpan={9}>No holdings yet for {summary.account}.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </section>

    </main>
  );
}
