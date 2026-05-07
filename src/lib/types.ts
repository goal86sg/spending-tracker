export interface Transaction {
  id: string;
  date: string;         // ISO date YYYY-MM-DD
  description: string;
  amount: number;       // negative = expense, positive = income
  category: string;
  account: string;      // e.g. "DBS Credit Card", "OCBC Bank", "UOB"
  month: string;        // YYYY-MM
  raw: string;          // original line for debugging
}

export interface MonthlySummary {
  month: string;        // YYYY-MM
  totalIn: number;
  totalOut: number;
  net: number;
  transactionCount: number;
  categories: Record<string, number>;  // category → total spend
}

export interface SpendingTrend {
  months: MonthlySummary[];
  grandTotal: number;
  avgMonthly: number;
  topCategories: { category: string; total: number }[];
}
