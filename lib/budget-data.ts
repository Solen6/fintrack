export type BudgetCategoryId =
  | "subscriptions"
  | "groceries"
  | "entertainment"
  | "eatingout"
  | "medical"
  | "gifts"
  | "miscellaneous"
  | "dates";

export interface BudgetCategory {
  id: BudgetCategoryId;
  label: string;
  color: string;       // OKLCH
  budget: number;      // monthly budget target
}

export interface Transaction {
  id: string;
  category: BudgetCategoryId;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
}

export interface MonthData {
  month: string;  // "2025-05"
  label: string;  // "May 2025"
  income: number;
  transactions: Transaction[];
}

/* ─── Category definitions with unique colors ─── */
export const BUDGET_CATEGORIES: BudgetCategory[] = [
  { id: "subscriptions",  label: "Subscriptions",   color: "oklch(0.62 0.09 240)",  budget: 120  },
  { id: "groceries",      label: "Groceries / Gas",  color: "oklch(0.70 0.12 55)",   budget: 700  },
  { id: "entertainment",  label: "Entertainment",    color: "oklch(0.62 0.10 290)",  budget: 200  },
  { id: "eatingout",      label: "Eating Out",       color: "oklch(0.65 0.14 25)",   budget: 350  },
  { id: "medical",        label: "Medical",          color: "oklch(0.64 0.08 180)",  budget: 100  },
  { id: "gifts",          label: "Gifts",            color: "oklch(0.64 0.10 340)",  budget: 80   },
  { id: "miscellaneous",  label: "Miscellaneous",    color: "oklch(0.62 0.09 145)",  budget: 250  },
  { id: "dates",          label: "Dates",            color: "oklch(0.74 0.11 74)",   budget: 200  },
];

/* ─── Seeded deterministic mock data ─── */
function makeMonthData(
  monthKey: string,
  label: string,
  income: number,
  txns: Omit<Transaction, "id">[]
): MonthData {
  return {
    month: monthKey,
    label,
    income,
    transactions: txns.map((t, i) => ({ ...t, id: `${monthKey}-${i}` })),
  };
}

export const BUDGET_MONTHS: MonthData[] = [
  makeMonthData("2025-06", "Jun 2025", 8400, [
    { category: "subscriptions",  description: "Netflix",         amount: 18,   date: "2025-06-01" },
    { category: "subscriptions",  description: "Spotify",         amount: 12,   date: "2025-06-01" },
    { category: "subscriptions",  description: "iCloud",          amount: 3,    date: "2025-06-01" },
    { category: "subscriptions",  description: "Gym",             amount: 55,   date: "2025-06-02" },
    { category: "subscriptions",  description: "ChatGPT Plus",    amount: 20,   date: "2025-06-03" },
    { category: "groceries",      description: "Whole Foods",      amount: 142,  date: "2025-06-03" },
    { category: "groceries",      description: "Shell",            amount: 68,   date: "2025-06-04" },
    { category: "groceries",      description: "Trader Joe's",     amount: 89,   date: "2025-06-07" },
    { category: "groceries",      description: "Costco",           amount: 210,  date: "2025-06-09" },
    { category: "groceries",      description: "BP",               amount: 54,   date: "2025-06-14" },
    { category: "entertainment",  description: "AMC Theaters",     amount: 32,   date: "2025-06-06" },
    { category: "entertainment",  description: "Steam",            amount: 25,   date: "2025-06-10" },
    { category: "entertainment",  description: "Concert tickets",  amount: 140,  date: "2025-06-12" },
    { category: "eatingout",      description: "Chipotle",         amount: 24,   date: "2025-06-05" },
    { category: "eatingout",      description: "Sushi restaurant", amount: 88,   date: "2025-06-08" },
    { category: "eatingout",      description: "Starbucks",        amount: 18,   date: "2025-06-11" },
    { category: "eatingout",      description: "Shake Shack",      amount: 36,   date: "2025-06-15" },
    { category: "medical",        description: "CVS Pharmacy",     amount: 34,   date: "2025-06-07" },
    { category: "gifts",          description: "Amazon gift",      amount: 65,   date: "2025-06-13" },
    { category: "miscellaneous",  description: "Amazon",           amount: 94,   date: "2025-06-04" },
    { category: "miscellaneous",  description: "Target",           amount: 78,   date: "2025-06-10" },
    { category: "miscellaneous",  description: "Hardware store",   amount: 45,   date: "2025-06-16" },
    { category: "dates",          description: "Dinner & show",    amount: 145,  date: "2025-06-14" },
    { category: "dates",          description: "Mini golf",        amount: 40,   date: "2025-06-07" },
  ]),

  makeMonthData("2025-05", "May 2025", 8200, [
    { category: "subscriptions",  description: "Netflix",         amount: 18,   date: "2025-05-01" },
    { category: "subscriptions",  description: "Spotify",         amount: 12,   date: "2025-05-01" },
    { category: "subscriptions",  description: "iCloud",          amount: 3,    date: "2025-05-01" },
    { category: "subscriptions",  description: "Gym",             amount: 55,   date: "2025-05-02" },
    { category: "subscriptions",  description: "ChatGPT Plus",    amount: 20,   date: "2025-05-03" },
    { category: "groceries",      description: "Whole Foods",      amount: 156,  date: "2025-05-03" },
    { category: "groceries",      description: "Shell",            amount: 72,   date: "2025-05-05" },
    { category: "groceries",      description: "Trader Joe's",     amount: 94,   date: "2025-05-08" },
    { category: "groceries",      description: "Costco",           amount: 198,  date: "2025-05-11" },
    { category: "entertainment",  description: "AMC Theaters",     amount: 28,   date: "2025-05-09" },
    { category: "entertainment",  description: "Bowling alley",    amount: 48,   date: "2025-05-17" },
    { category: "eatingout",      description: "Chipotle",         amount: 22,   date: "2025-05-06" },
    { category: "eatingout",      description: "Italian dinner",   amount: 110,  date: "2025-05-10" },
    { category: "eatingout",      description: "Starbucks",        amount: 24,   date: "2025-05-14" },
    { category: "eatingout",      description: "Thai takeout",     amount: 42,   date: "2025-05-20" },
    { category: "medical",        description: "Co-pay",           amount: 50,   date: "2025-05-08" },
    { category: "medical",        description: "Pharmacy",         amount: 28,   date: "2025-05-15" },
    { category: "gifts",          description: "Mother's Day gift", amount: 120, date: "2025-05-10" },
    { category: "miscellaneous",  description: "Amazon",           amount: 67,   date: "2025-05-07" },
    { category: "miscellaneous",  description: "Target",           amount: 55,   date: "2025-05-13" },
    { category: "dates",          description: "Rooftop bar",      amount: 95,   date: "2025-05-16" },
    { category: "dates",          description: "Picnic supplies",  amount: 38,   date: "2025-05-24" },
  ]),

  makeMonthData("2025-04", "Apr 2025", 8200, [
    { category: "subscriptions",  description: "Netflix",         amount: 18,   date: "2025-04-01" },
    { category: "subscriptions",  description: "Spotify",         amount: 12,   date: "2025-04-01" },
    { category: "subscriptions",  description: "Gym",             amount: 55,   date: "2025-04-02" },
    { category: "subscriptions",  description: "ChatGPT Plus",    amount: 20,   date: "2025-04-03" },
    { category: "groceries",      description: "Whole Foods",      amount: 134,  date: "2025-04-04" },
    { category: "groceries",      description: "BP",               amount: 62,   date: "2025-04-06" },
    { category: "groceries",      description: "Trader Joe's",     amount: 88,   date: "2025-04-10" },
    { category: "groceries",      description: "Costco",           amount: 185,  date: "2025-04-13" },
    { category: "entertainment",  description: "Netflix add-on",   amount: 8,    date: "2025-04-05" },
    { category: "entertainment",  description: "Golf range",       amount: 45,   date: "2025-04-19" },
    { category: "eatingout",      description: "Chipotle",         amount: 20,   date: "2025-04-07" },
    { category: "eatingout",      description: "Steakhouse",       amount: 145,  date: "2025-04-12" },
    { category: "eatingout",      description: "Starbucks",        amount: 22,   date: "2025-04-16" },
    { category: "medical",        description: "Annual physical",  amount: 0,    date: "2025-04-09" },
    { category: "gifts",          description: "Birthday gift",    amount: 55,   date: "2025-04-22" },
    { category: "miscellaneous",  description: "Amazon",           amount: 112,  date: "2025-04-08" },
    { category: "miscellaneous",  description: "Home Depot",       amount: 88,   date: "2025-04-14" },
    { category: "dates",          description: "Wine tasting",     amount: 110,  date: "2025-04-18" },
    { category: "dates",          description: "Cooking class",    amount: 80,   date: "2025-04-25" },
  ]),
];

/* ─── Helper: compute totals for a month ─── */
export function computeMonthTotals(month: MonthData) {
  const byCategory: Partial<Record<BudgetCategoryId, number>> = {};
  for (const t of month.transactions) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount;
  }
  const totalExpenses = Object.values(byCategory).reduce((s, v) => s + (v ?? 0), 0);
  const net = month.income - totalExpenses;
  const savingsRate = month.income > 0 ? (net / month.income) * 100 : 0;
  return { byCategory, totalExpenses, net, savingsRate };
}
