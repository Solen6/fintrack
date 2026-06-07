import * as XLSX from "xlsx";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..");

/* ─── portfolio.xlsx ─── */

const holdingsData = [
  // Header row
  ["Ticker", "Account", "Shares", "Cost Basis", "Sector", "Notes"],
  // Sample holdings — replace with your real data
  ["AAPL",  "Brokerage", 25,   167.40, "Technology",    "Core position"],
  ["MSFT",  "Brokerage", 12,   318.50, "Technology",    ""],
  ["VOO",   "Brokerage", 10,   420.00, "Index",         ""],
  ["NVDA",  "Brokerage",  8,   492.30, "Semiconductors","Trim if above $950"],
  ["JPM",   "Brokerage", 15,   178.90, "Financials",    ""],
  ["BRK.B", "Brokerage", 20,   338.10, "Financials",    ""],
  ["COP",   "Brokerage", 18,   112.40, "Energy",        "Watch $95 support"],
  ["TLT",   "Brokerage", 30,    98.20, "Fixed Income",  "Rate hedge"],
  ["VTI",   "Roth",      22,   218.30, "Index",         ""],
  ["VXUS",  "Roth",      18,    54.80, "Index",         "International diversification"],
  ["AVUV",  "Roth",      14,    86.40, "Small Cap",     ""],
  ["GOOGL", "Roth",       5,   132.60, "Technology",    ""],
  ["META",  "Roth",       4,   298.40, "Technology",    ""],
];

const portfolioWb = XLSX.utils.book_new();
const holdingsWs = XLSX.utils.aoa_to_sheet(holdingsData);

// Column widths
holdingsWs["!cols"] = [
  { wch: 8 },  // Ticker
  { wch: 12 }, // Account
  { wch: 8 },  // Shares
  { wch: 12 }, // Cost Basis
  { wch: 16 }, // Sector
  { wch: 30 }, // Notes
];

XLSX.utils.book_append_sheet(portfolioWb, holdingsWs, "Holdings");
const portfolioPath = join(outDir, "portfolio-template.xlsx");
writeFileSync(portfolioPath, XLSX.write(portfolioWb, { type: "buffer", bookType: "xlsx" }));
console.log("✓ Created portfolio-template.xlsx");

/* ─── budget.xlsx ─── */

const transactionsData = [
  // Header row
  ["Date", "Category", "Description", "Amount"],

  // Income
  ["2025-06-01", "Income",          "Paycheck",              8400],
  ["2025-05-01", "Income",          "Paycheck",              8200],
  ["2025-04-01", "Income",          "Paycheck",              8200],

  // June 2025 expenses
  ["2025-06-01", "Subscriptions",   "Netflix",                 18],
  ["2025-06-01", "Subscriptions",   "Spotify",                 12],
  ["2025-06-01", "Subscriptions",   "iCloud",                   3],
  ["2025-06-02", "Subscriptions",   "Gym",                     55],
  ["2025-06-03", "Subscriptions",   "ChatGPT Plus",            20],
  ["2025-06-03", "Groceries/Gas",   "Whole Foods",            142],
  ["2025-06-04", "Groceries/Gas",   "Shell",                   68],
  ["2025-06-07", "Groceries/Gas",   "Trader Joe's",            89],
  ["2025-06-09", "Groceries/Gas",   "Costco",                 210],
  ["2025-06-14", "Groceries/Gas",   "BP",                      54],
  ["2025-06-06", "Entertainment",   "AMC Theaters",            32],
  ["2025-06-10", "Entertainment",   "Steam",                   25],
  ["2025-06-12", "Entertainment",   "Concert tickets",        140],
  ["2025-06-05", "Eating Out",      "Chipotle",                24],
  ["2025-06-08", "Eating Out",      "Sushi restaurant",        88],
  ["2025-06-11", "Eating Out",      "Starbucks",               18],
  ["2025-06-15", "Eating Out",      "Shake Shack",             36],
  ["2025-06-07", "Medical",         "CVS Pharmacy",            34],
  ["2025-06-13", "Gifts",           "Amazon gift",             65],
  ["2025-06-04", "Miscellaneous",   "Amazon",                  94],
  ["2025-06-10", "Miscellaneous",   "Target",                  78],
  ["2025-06-16", "Miscellaneous",   "Hardware store",          45],
  ["2025-06-14", "Dates",           "Dinner & show",          145],
  ["2025-06-07", "Dates",           "Mini golf",               40],

  // May 2025 expenses
  ["2025-05-01", "Subscriptions",   "Netflix",                 18],
  ["2025-05-01", "Subscriptions",   "Spotify",                 12],
  ["2025-05-02", "Subscriptions",   "Gym",                     55],
  ["2025-05-03", "Subscriptions",   "ChatGPT Plus",            20],
  ["2025-05-03", "Groceries/Gas",   "Whole Foods",            156],
  ["2025-05-05", "Groceries/Gas",   "Shell",                   72],
  ["2025-05-08", "Groceries/Gas",   "Trader Joe's",            94],
  ["2025-05-11", "Groceries/Gas",   "Costco",                 198],
  ["2025-05-09", "Entertainment",   "AMC Theaters",            28],
  ["2025-05-17", "Entertainment",   "Bowling alley",           48],
  ["2025-05-06", "Eating Out",      "Chipotle",                22],
  ["2025-05-10", "Eating Out",      "Italian dinner",         110],
  ["2025-05-14", "Eating Out",      "Starbucks",               24],
  ["2025-05-20", "Eating Out",      "Thai takeout",            42],
  ["2025-05-08", "Medical",         "Co-pay",                  50],
  ["2025-05-15", "Medical",         "Pharmacy",                28],
  ["2025-05-10", "Gifts",           "Mother's Day gift",      120],
  ["2025-05-07", "Miscellaneous",   "Amazon",                  67],
  ["2025-05-13", "Miscellaneous",   "Target",                  55],
  ["2025-05-16", "Dates",           "Rooftop bar",             95],
  ["2025-05-24", "Dates",           "Picnic supplies",         38],
];

const budgetWb = XLSX.utils.book_new();
const txnWs = XLSX.utils.aoa_to_sheet(transactionsData);

txnWs["!cols"] = [
  { wch: 12 }, // Date
  { wch: 18 }, // Category
  { wch: 28 }, // Description
  { wch: 10 }, // Amount
];

XLSX.utils.book_append_sheet(budgetWb, txnWs, "Transactions");
const budgetPath = join(outDir, "budget-template.xlsx");
writeFileSync(budgetPath, XLSX.write(budgetWb, { type: "buffer", bookType: "xlsx" }));
console.log("✓ Created budget-template.xlsx");

console.log("\nUpload both files to your OneDrive, then select them in the Accounts tab.");
