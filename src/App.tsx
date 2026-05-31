import { useEffect, useMemo, useState } from 'react';
import './App.css';

type RangeKey = '1M' | '3M' | '6M' | '1Y';

type MonthlyRecord = {
  id: string;
  monthKey: string;
  monthLabel: string;
  income: number;
  expenses: number;
  savedAt: string;
};

type EditableItem = {
  id: string;
  label: string;
  value: number;
  color: string;
};

type DashboardState = {
  income: EditableItem[];
  expenses: EditableItem[];
};

const STORAGE_KEY = 'jsinvestments-income-expenses-dashboard.v1';
const colorPalette = ['#60a5fa', '#a78bfa', '#4ade80', '#fbbf24', '#22d3ee', '#f472b6', '#fb923c', '#94a3b8'];

function makeItem(label: string, value: number, color: string): EditableItem {
  return {
    id: crypto.randomUUID(),
    label,
    value,
    color,
  };
}

function monthKeyFor(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFor(date: Date) {
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function buildMonthlyRecord(state: DashboardState, date = new Date()): MonthlyRecord {
  const income = state.income.reduce((sum, item) => sum + item.value, 0);
  const expenses = state.expenses.reduce((sum, item) => sum + item.value, 0);
  return {
    id: crypto.randomUUID(),
    monthKey: monthKeyFor(date),
    monthLabel: monthLabelFor(date),
    income,
    expenses,
    savedAt: date.toISOString(),
  };
}

function mergeMonthlyRecord(history: MonthlyRecord[], nextRecord: MonthlyRecord) {
  const withoutMonth = history.filter((record) => record.monthKey !== nextRecord.monthKey);
  const merged = [...withoutMonth, nextRecord].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  return merged;
}

function normalizeMonthlyRecords(records: unknown) {
  if (!Array.isArray(records)) return [] as MonthlyRecord[];
  return records
    .filter((record): record is MonthlyRecord => {
      if (!record || typeof record !== 'object') return false;
      const value = record as Partial<MonthlyRecord>;
      return (
        typeof value.id === 'string' &&
        typeof value.monthKey === 'string' &&
        typeof value.monthLabel === 'string' &&
        typeof value.income === 'number' &&
        typeof value.expenses === 'number' &&
        typeof value.savedAt === 'string'
      );
    })
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

const defaultState: DashboardState = {
  income: [
    makeItem('Pension', 4100, colorPalette[0]),
    makeItem('Excess Pension', 850, colorPalette[1]),
    makeItem('VA', 2150, colorPalette[2]),
    makeItem('Dividends', 1400, colorPalette[3]),
    makeItem('Other', 850, colorPalette[4]),
  ],
  expenses: [
    makeItem('Housing', 2100, '#fb7185'),
    makeItem('Utilities', 450, colorPalette[0]),
    makeItem('Food', 770, colorPalette[3]),
    makeItem('Transportation', 500, colorPalette[4]),
    makeItem('Insurance', 700, colorPalette[1]),
    makeItem('Medical', 380, colorPalette[2]),
    makeItem('School', 600, '#f472b6'),
    makeItem('Debt Payments', 640, '#fb923c'),
    makeItem('Entertainment', 200, '#bef264'),
    makeItem('Other', 260, '#94a3b8'),
  ],
};

function currency(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function makeAreaPath(values: number[], width: number, height: number, padding: number, domain?: { min: number; max: number }) {
  const min = domain?.min ?? Math.min(...values);
  const max = domain?.max ?? Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;

  const points = values.map((value, index) => {
    const x = padding + index * step;
    const normalized = (value - min) / range;
    const y = height - padding - normalized * (height - padding * 2);
    return { x, y };
  });

  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;

  return { points, line, area };
}

function sectionRows(items: EditableItem[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item) => ({
    ...item,
    pct: total > 0 ? (item.value / total) * 100 : 0,
  }));
}

function App() {
  const [range, setRange] = useState<RangeKey>('1Y');
  const [state, setState] = useState<DashboardState>(defaultState);
  const [monthlyRecords, setMonthlyRecords] = useState<MonthlyRecord[]>([]);
  const [saveMessage, setSaveMessage] = useState('Not saved yet');
  const [hasLoadedSavedData, setHasLoadedSavedData] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setMonthlyRecords([buildMonthlyRecord(defaultState)]);
        setHasLoadedSavedData(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<DashboardState> & { monthlyRecords?: unknown };
      const nextState =
        Array.isArray(parsed.income) && Array.isArray(parsed.expenses)
          ? { income: parsed.income, expenses: parsed.expenses }
          : defaultState;

      if (Array.isArray(parsed.income) && Array.isArray(parsed.expenses)) {
        setState(nextState);
      }

      const storedHistory = normalizeMonthlyRecords(parsed.monthlyRecords);
      setMonthlyRecords(storedHistory.length > 0 ? storedHistory : [buildMonthlyRecord(nextState)]);
      setHasLoadedSavedData(true);
    } catch {
      setMonthlyRecords([buildMonthlyRecord(defaultState)]);
      setHasLoadedSavedData(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedData) return;

    const nextRecord = buildMonthlyRecord(state);
    setMonthlyRecords((current) => {
      const nextHistory = mergeMonthlyRecord(current, nextRecord);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          income: state.income,
          expenses: state.expenses,
          monthlyRecords: nextHistory,
        }),
      );
      setSaveMessage(
        `Auto-saved current month at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`,
      );
      return nextHistory;
    });
  }, [state, hasLoadedSavedData]);

  const rangeSizes: Record<RangeKey, number> = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
  };

  const selected = monthlyRecords.slice(-rangeSizes[range]);
  const chartSeries = selected.length > 0 ? selected : [buildMonthlyRecord(state)];

  const totals = useMemo(() => {
    const totalIncome = state.income.reduce((sum, item) => sum + item.value, 0);
    const totalExpenses = state.expenses.reduce((sum, item) => sum + item.value, 0);
    const netIncome = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;
    return { totalIncome, totalExpenses, netIncome, savingsRate };
  }, [state]);

  const chart = useMemo(() => {
    const width = 960;
    const height = 320;
    const padding = 28;
    const incomeSeries = chartSeries.map((point) => point.income);
    const expenseSeries = chartSeries.map((point) => point.expenses);
    const domain = {
      min: Math.min(...incomeSeries, ...expenseSeries),
      max: Math.max(...incomeSeries, ...expenseSeries),
    };
    const incomePath = makeAreaPath(incomeSeries, width, height, padding, domain);
    const expensePath = makeAreaPath(expenseSeries, width, height, padding, domain);
    return { width, height, padding, incomePath, expensePath };
  }, [chartSeries]);

  const incomeRows = sectionRows(state.income);
  const expenseRows = sectionRows(state.expenses);
  const incomeTotal = totals.totalIncome;
  const expenseTotal = totals.totalExpenses;

  const budgetHistory = monthlyRecords.slice(-rangeSizes[range]);
  const budgetBase = budgetHistory.length > 0 ? budgetHistory : [buildMonthlyRecord(state)];
  const budgetPlan = budgetBase.reduce(
    (acc, point) => {
      acc.income += point.income;
      acc.expenses += point.expenses;
      return acc;
    },
    { income: 0, expenses: 0 },
  );
  const budgetAverageIncome = budgetPlan.income / budgetBase.length;
  const budgetAverageExpenses = budgetPlan.expenses / budgetBase.length;
  const budgetVariance = budgetAverageIncome - budgetAverageExpenses;
  const budgetSavingsRate = budgetAverageIncome > 0 ? (budgetVariance / budgetAverageIncome) * 100 : 0;
  const expensePriority = [...expenseRows].sort((a, b) => b.value - a.value);
  const reviewCategory = expensePriority[0]?.label ?? 'N/A';
  const watchCategory = expensePriority[1]?.label ?? expensePriority[0]?.label ?? 'N/A';
  const cashFlowStatus = totals.netIncome >= 0 ? 'Positive' : 'Negative';

  function updateValue(section: 'income' | 'expenses', id: string, value: string) {
    const nextValue = Number(value.replace(/[^\d.]/g, '')) || 0;
    setState((current) => ({
      ...current,
      [section]: current[section].map((item) => (item.id === id ? { ...item, value: nextValue } : item)),
    }));
  }

  function updateLabel(section: 'income' | 'expenses', id: string, value: string) {
    setState((current) => ({
      ...current,
      [section]: current[section].map((item) => (item.id === id ? { ...item, label: value } : item)),
    }));
  }

  function addRow(section: 'income' | 'expenses') {
    const nextColor = colorPalette[(state[section].length + 1) % colorPalette.length];
    const newItem = makeItem(section === 'income' ? 'New income' : 'New expense', 0, nextColor);
    setState((current) => ({
      ...current,
      [section]: [...current[section], newItem],
    }));
  }

  function removeRow(section: 'income' | 'expenses', id: string) {
    setState((current) => ({
      ...current,
      [section]: current[section].filter((item) => item.id !== id),
    }));
  }

  function saveNow() {
    const snapshot = buildMonthlyRecord(state);
    const nextHistory = mergeMonthlyRecord(monthlyRecords, snapshot);
    setMonthlyRecords(nextHistory);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        income: state.income,
        expenses: state.expenses,
        monthlyRecords: nextHistory,
      }),
    );
    setSaveMessage(
      `Saved at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`,
    );
  }

  return (
    <main className="page">
      <section className="hero card">
        <div>
          <p className="eyebrow">JSInvestments dashboard</p>
          <h1>Income vs Expenses</h1>
          <p className="lead">
            Track pensions, dividends, VA benefits, and monthly spending in one clear view.
          </p>
        </div>
        <div className="hero-actions">
          <button className="ghost" type="button" onClick={saveNow}>
            Save changes
          </button>
          <button className="ghost" type="button" onClick={() => setState(defaultState)}>
            Reset defaults
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              setMonthlyRecords([buildMonthlyRecord(state)]);
              setSaveMessage('Saved data cleared');
            }}
          >
            Clear saved data
          </button>
        </div>
      </section>

      <section className="range-bar card">
        <div className="range-copy">
          <strong>Selected range</strong>
          <span>Compare monthly cash flow across different time windows.</span>
        </div>
        <div className="range-buttons" role="tablist" aria-label="Dashboard time range">
          {(['1M', '3M', '6M', '1Y'] as RangeKey[]).map((key) => (
            <button
              key={key}
              className={key === range ? 'range-button active' : 'range-button'}
              onClick={() => setRange(key)}
              type="button"
            >
              {key}
            </button>
          ))}
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric card">
          <span>Total Income</span>
          <strong className="positive">{currency(totals.totalIncome)}</strong>
          <small>Current range</small>
        </article>
        <article className="metric card">
          <span>Total Expenses</span>
          <strong className="negative">{currency(totals.totalExpenses)}</strong>
          <small>Current range</small>
        </article>
        <article className="metric card">
          <span>Net Income</span>
          <strong className={totals.netIncome >= 0 ? 'positive' : 'negative'}>
            {currency(totals.netIncome)}
          </strong>
          <small>Income minus expenses</small>
        </article>
        <article className="metric card">
          <span>Savings Rate</span>
          <strong className="blue">{totals.savingsRate.toFixed(1)}%</strong>
          <small>Saved from income</small>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-head">
            <div>
              <h2>Income vs Expenses Trend</h2>
              <p>Green = income, red = expenses</p>
            </div>
            <div className="panel-pill">{range} view</div>
          </div>

          <div className="chart-wrap">
            <div className="chart-legend" aria-label="Chart legend">
              <span><i className="legend-swatch income" />Income</span>
              <span><i className="legend-swatch expense" />Expenses</span>
              <span className="legend-note">Hover a dot for the month details</span>
            </div>
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="chart" role="img" aria-label="Income and expenses chart">
              <defs>
                <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity="0.03" />
                </linearGradient>
              </defs>

              {[0.2, 0.4, 0.6, 0.8].map((grid, index) => (
                <line
                  key={index}
                  x1={chart.padding}
                  x2={chart.width - chart.padding}
                  y1={chart.padding + (chart.height - chart.padding * 2) * grid}
                  y2={chart.padding + (chart.height - chart.padding * 2) * grid}
                  className="grid-line"
                />
              ))}

              <path d={`M ${chart.incomePath.area}`} fill="url(#incomeGradient)" />
              <path d={`M ${chart.expensePath.area}`} fill="url(#expenseGradient)" />

              <polyline
                points={chart.incomePath.line}
                fill="none"
                stroke="#4ade80"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={chart.expensePath.line}
                fill="none"
                stroke="#fb7185"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {chartSeries.map((point, index) => (
                <line
                  key={`connector-${point.monthLabel}`}
                  x1={chart.incomePath.points[index]?.x ?? 0}
                  x2={chart.incomePath.points[index]?.x ?? 0}
                  y1={chart.incomePath.points[index]?.y ?? 0}
                  y2={chart.expensePath.points[index]?.y ?? 0}
                  className="month-connector"
                />
              ))}

              {chart.incomePath.points.map((point, index) => (
                <circle
                  key={`income-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="6"
                  className="chart-dot income-dot"
                >
                  <title>{`${chartSeries[index].monthLabel} — Income ${currency(chartSeries[index].income)}`}</title>
                </circle>
              ))}
              {chart.expensePath.points.map((point, index) => (
                <circle
                  key={`expense-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="6"
                  className="chart-dot expense-dot"
                >
                  <title>{`${chartSeries[index].monthLabel} — Expenses ${currency(chartSeries[index].expenses)}`}</title>
                </circle>
              ))}

              {chartSeries.map((point, index) => {
                const x = chart.incomePath.points[index]?.x ?? 0;
                return (
                  <text key={point.monthLabel} x={x} y={chart.height - 6} className="axis-label">
                    {point.monthLabel}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="chart-footer">
            <div>
              Income: <strong className="positive">{currency(chartSeries.reduce((sum, point) => sum + point.income, 0))}</strong>
            </div>
            <div>
              Expense: <strong className="negative">{currency(chartSeries.reduce((sum, point) => sum + point.expenses, 0))}</strong>
            </div>
            <div>
              Net Cash Flow: <strong className={chartSeries.reduce((sum, point) => sum + point.income, 0) - chartSeries.reduce((sum, point) => sum + point.expenses, 0) >= 0 ? 'positive' : 'negative'}>
                {currency(chartSeries.reduce((sum, point) => sum + point.income, 0) - chartSeries.reduce((sum, point) => sum + point.expenses, 0))}
              </strong>
            </div>
          </div>
          <p className="save-status">{saveMessage}</p>
        </article>

        <aside className="panel">
          <div className="panel-head panel-head-stack">
            <div>
              <h2>Income Breakdown</h2>
              <p>Edit the amount and category names directly</p>
            </div>
            <button className="ghost inline-action" type="button" onClick={() => addRow('income')}>
              + Add income row
            </button>
          </div>

          <div className="breakdown-list">
            {incomeRows.map((item) => (
              <div key={item.id} className="breakdown-editor">
                <input
                  className="field name-field"
                  value={item.label}
                  onChange={(e) => updateLabel('income', item.id, e.target.value)}
                  aria-label={`Income label ${item.label}`}
                />
                <div className="bar">
                  <div style={{ width: `${item.pct}%`, background: item.color }} />
                </div>
                <div className="row-actions">
                  <input
                    className="field amount-field"
                    inputMode="numeric"
                    value={item.value}
                    onChange={(e) => updateValue('income', item.id, e.target.value)}
                    aria-label={`Income amount ${item.label}`}
                  />
                  <button className="row-delete" type="button" onClick={() => removeRow('income', item.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div className="breakdown-editor total-row">
              <div className="breakdown-name total-name">
                <span className="dot total-dot" />
                Total Income
              </div>
              <div className="bar">
                <div style={{ width: '100%', background: 'linear-gradient(90deg, #4ade80, #60a5fa)' }} />
              </div>
              <div className="breakdown-value total-value">{currency(incomeTotal)}</div>
            </div>
          </div>
        </aside>
      </section>

      <section className="content-grid lower-grid">
        <article className="panel">
          <div className="panel-head panel-head-stack">
            <div>
              <h2>Expense Breakdown</h2>
              <p>Edit housing, utilities, school, and the rest</p>
            </div>
            <button className="ghost inline-action" type="button" onClick={() => addRow('expenses')}>
              + Add expense row
            </button>
          </div>

          <div className="breakdown-list">
            {expenseRows.map((item) => (
              <div key={item.id} className="breakdown-editor">
                <input
                  className="field name-field"
                  value={item.label}
                  onChange={(e) => updateLabel('expenses', item.id, e.target.value)}
                  aria-label={`Expense label ${item.label}`}
                />
                <div className="bar">
                  <div style={{ width: `${item.pct}%`, background: item.color }} />
                </div>
                <div className="row-actions">
                  <input
                    className="field amount-field"
                    inputMode="numeric"
                    value={item.value}
                    onChange={(e) => updateValue('expenses', item.id, e.target.value)}
                    aria-label={`Expense amount ${item.label}`}
                  />
                  <button className="row-delete" type="button" onClick={() => removeRow('expenses', item.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div className="breakdown-editor total-row">
              <div className="breakdown-name total-name">
                <span className="dot total-dot negative" />
                Total Expenses
              </div>
              <div className="bar">
                <div style={{ width: '100%', background: 'linear-gradient(90deg, #fb7185, #fbbf24)' }} />
              </div>
              <div className="breakdown-value total-value">{currency(expenseTotal)}</div>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Budget & Cash Flow</h2>
              <p>High-level monthly planning</p>
            </div>
          </div>

          <div className="budget-grid">
            <div className="stat-box">
              <span>Planned Income</span>
              <strong className="positive">{currency(budgetAverageIncome)}</strong>
              <p>Average from saved months in this range</p>
            </div>
            <div className="stat-box">
              <span>Planned Expenses</span>
              <strong className="negative">{currency(budgetAverageExpenses)}</strong>
              <p>Average spending from saved months</p>
            </div>
            <div className="stat-box">
              <span>Budget Variance</span>
              <strong className={budgetVariance >= 0 ? 'positive' : 'negative'}>
                {budgetVariance >= 0 ? '+' : '-'}{currency(Math.abs(budgetVariance))}
              </strong>
              <p>Average income minus average expenses</p>
            </div>
            <div className="stat-box">
              <span>Savings Goal</span>
              <strong className="blue">{budgetSavingsRate.toFixed(1)}%</strong>
              <p>Based on the selected saved range</p>
            </div>
          </div>

          <div className="insight-list">
            <div className="insight-row">
              <span>Best category to review</span>
              <strong>{reviewCategory}</strong>
            </div>
            <div className="insight-row">
              <span>Watch category</span>
              <strong>{watchCategory}</strong>
            </div>
            <div className="insight-row">
              <span>Cash flow status</span>
              <strong className={cashFlowStatus === 'Positive' ? 'positive' : 'negative'}>{cashFlowStatus}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Monthly Summary</h2>
            <p>Auto-saved month snapshots from this device</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Income</th>
                <th>Expenses</th>
                <th>Net Income</th>
                <th>Savings Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr className="current-month-row">
                <td>Current month</td>
                <td>{currency(totals.totalIncome)}</td>
                <td>{currency(totals.totalExpenses)}</td>
                <td className={totals.netIncome >= 0 ? 'positive' : 'negative'}>{currency(totals.netIncome)}</td>
                <td>{totals.savingsRate.toFixed(1)}%</td>
              </tr>
              {selected.map((point) => {
                const net = point.income - point.expenses;
                const savings = ((net / point.income) * 100).toFixed(1);
                return (
                  <tr key={point.monthKey}>
                    <td>{point.monthLabel}</td>
                    <td>{currency(point.income)}</td>
                    <td>{currency(point.expenses)}</td>
                    <td className={net >= 0 ? 'positive' : 'negative'}>{currency(net)}</td>
                    <td>{savings}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
