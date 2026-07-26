/* Flatten a month's three report payloads into a single sectioned CSV for
   download. Pure (no DOM) so it can be unit-tested; the component wraps the
   output in a Blob and triggers the download. Numbers are emitted raw (no $/%
   glyphs) so they land as real numbers in a spreadsheet. */

import type { CashFlowReport, PortfolioReport, TaxReport } from "@/lib/monthly-reports";

/** Escape a CSV field per RFC 4180 (quote when it holds a comma/quote/newline). */
function cell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(cell).join(",");
}

function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function buildReportCsv(params: {
  period: string;
  scopeLabel: string;
  portfolio?: PortfolioReport;
  cashFlow?: CashFlowReport;
  tax?: TaxReport;
}): string {
  const { period, scopeLabel, portfolio, cashFlow, tax } = params;
  const lines: string[] = [];
  const blank = () => lines.push("");

  lines.push(row("Monthly Report", scopeLabel, monthLabel(period)));

  if (portfolio) {
    const me = portfolio.monthEnd;
    const t = portfolio.totals;
    blank();
    lines.push(row("Portfolio Performance"));
    lines.push(row("Metric", "Value"));
    lines.push(row("Month-end value", me.total));
    lines.push(row("Monthly return %", me.monthReturnPct));
    lines.push(row("Market value", t.value));
    lines.push(row("Cost basis", t.costBasis));
    lines.push(row("Unrealized gain/loss", t.gain));
    lines.push(row("Unrealized gain/loss %", t.gainPct));
    lines.push(row("Cash", t.cash));

    if (portfolio.risk) {
      const r = portfolio.risk;
      blank();
      lines.push(row("Risk & Benchmark", `vs ${r.benchmarkSymbol}`));
      lines.push(row("Metric", "Value"));
      lines.push(row("Beta", r.beta));
      lines.push(row("Alpha (monthly) %", r.alpha));
      lines.push(row("Volatility (annualized) %", r.volatility));
      lines.push(row(`${r.benchmarkSymbol} return %`, r.benchmarkReturn));
      lines.push(row("Risk-free rate %", r.riskFreeRate));
      lines.push(row("Trading days observed", r.observations));
    }

    if (portfolio.positions.length > 0) {
      blank();
      lines.push(row("Positions"));
      lines.push(row("Ticker", "Name", "Sector", "Shares", "Cost/Share", "Price", "Value", "Gain/Loss", "Gain %", "Priced"));
      for (const p of portfolio.positions) {
        lines.push(row(p.ticker, p.name, p.sector, p.shares, p.costPerShare, p.price, p.value, p.gain, p.gainPct, p.priced ? "yes" : "no"));
      }
    }
  }

  if (cashFlow) {
    blank();
    lines.push(row("Cash Flow & Savings"));
    lines.push(row("Metric", "Value"));
    lines.push(row("Total inflows", cashFlow.inflows.total));
    lines.push(row("Total outflows", cashFlow.outflows.total));
    lines.push(row("Net cash flow", cashFlow.netCashFlow));
    lines.push(row("Savings rate %", cashFlow.savingsRate));
    blank();
    lines.push(row("Inflows"));
    lines.push(row("Deposits", cashFlow.inflows.deposits));
    lines.push(row("Sale proceeds", cashFlow.inflows.saleProceeds));
    lines.push(row("Dividends (cash)", cashFlow.inflows.dividends));
    lines.push(row("Interest", cashFlow.inflows.interest));
    lines.push(row("Transfers in", cashFlow.inflows.transfersIn));
    lines.push(row("Other", cashFlow.inflows.other));
    blank();
    lines.push(row("Outflows"));
    lines.push(row("Securities purchased", cashFlow.outflows.purchases));
    lines.push(row("Withdrawals", cashFlow.outflows.withdrawals));
    lines.push(row("Fees", cashFlow.outflows.fees));
    lines.push(row("Transfers out", cashFlow.outflows.transfersOut));
    lines.push(row("Other", cashFlow.outflows.other));

    if (cashFlow.events.length > 0) {
      blank();
      lines.push(row("Activity"));
      lines.push(row("Date", "Type", "Symbol", "Description", "Shares", "Price", "Amount"));
      for (const e of cashFlow.events) {
        lines.push(row(e.date, e.type, e.symbol ?? "", e.description, e.shares, e.price, e.amount));
      }
    }
  }

  if (tax) {
    blank();
    lines.push(row("Realized Gains & Income"));
    lines.push(row("Realized gain/loss", tax.realized.totalGain));
    lines.push(row("Dividend income (gross)", tax.income.totalGross));
    lines.push(row("Interest", tax.income.interest));
    lines.push(row("Fees", tax.fees.total));

    if (tax.realized.lots.length > 0) {
      blank();
      lines.push(row("Realized Lots"));
      lines.push(row("Date", "Ticker", "Shares", "Cost/Share", "Sale Price", "Proceeds", "Gain/Loss"));
      for (const l of tax.realized.lots) {
        lines.push(row(l.date, l.ticker, l.shares, l.costPerShare, l.salePrice, l.proceeds, l.gain));
      }
    }
    if (tax.income.dividends.length > 0) {
      blank();
      lines.push(row("Dividend Income by Ticker"));
      lines.push(row("Ticker", "Payments", "Gross", "Cash", "Reinvested"));
      for (const d of tax.income.dividends) {
        lines.push(row(d.ticker, d.payments, d.gross, d.cash, d.reinvested));
      }
    }
  }

  return lines.join("\n");
}
