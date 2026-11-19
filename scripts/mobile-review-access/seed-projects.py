import json
import os
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/srv/supacode-review/workspace")

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "Maya Chen",
    "GIT_AUTHOR_EMAIL": "maya@example.com",
    "GIT_COMMITTER_NAME": "Maya Chen",
    "GIT_COMMITTER_EMAIL": "maya@example.com",
}


def git(directory, *args, date=None):
    env = dict(GIT_ENV)
    if date:
        env["GIT_AUTHOR_DATE"] = date
        env["GIT_COMMITTER_DATE"] = date
    subprocess.run(["git", *args], cwd=directory, check=True, capture_output=True, env=env)


def write(directory, files):
    for name, content in files.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content.lstrip("\n"))


def build(name, commits, check):
    directory = root / name
    if (directory / ".git").exists():
        print(f"{name} already exists")
        return
    directory.mkdir(parents=True, exist_ok=True)
    git(directory, "init", "-b", "main")
    for date, message, files in commits:
        write(directory, files)
        git(directory, "add", ".")
        git(directory, "commit", "-m", message, date=date)
    subprocess.run(check, cwd=directory, check=True, capture_output=True)
    print(f"Created {name}")


TIDEPOOL_FORECAST_V1 = """
export const forecast = {
  location: "Brighton Marina",
  observedAt: "2026-11-18T07:00:00Z",
  temperatureC: 13.4,
  feelsLikeC: 11.2,
  windKmh: 18.6,
  windDirection: "SW",
  swellM: 0.9,
  tides: [
    { time: "03:12", heightM: 5.9, kind: "high" },
    { time: "09:26", heightM: 1.1, kind: "low" },
    { time: "15:38", heightM: 6.2, kind: "high" },
    { time: "21:51", heightM: 0.8, kind: "low" },
  ],
};

export function formatTemperature(celsius) {
  return `${Math.round(celsius)}°C`;
}

export function formatWind(kmh, direction) {
  return `${Math.round(kmh)} km/h ${direction}`;
}
"""

TIDEPOOL_FORECAST_V2 = TIDEPOOL_FORECAST_V1 + """
export function nextTide(tides, now) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (
    tides.find((tide) => {
      const [hours, mins] = tide.time.split(":").map(Number);
      return hours * 60 + mins > minutes;
    }) ?? tides[0]
  );
}

export function tidePath(tides, width, height) {
  const max = Math.max(...tides.map((tide) => tide.heightM));
  const step = width / (tides.length - 1);
  return tides
    .map((tide, index) => {
      const x = Math.round(index * step);
      const y = Math.round(height - (tide.heightM / max) * (height - 12) - 6);
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}
"""

TIDEPOOL_TESTS_V1 = """
import test from "node:test";
import assert from "node:assert/strict";
import { formatTemperature, formatWind } from "./forecast.mjs";

test("rounds the temperature", () => {
  assert.equal(formatTemperature(13.4), "13°C");
  assert.equal(formatTemperature(13.6), "14°C");
});

test("formats wind with its direction", () => {
  assert.equal(formatWind(18.6, "SW"), "19 km/h SW");
});
"""

TIDEPOOL_TESTS_V2 = TIDEPOOL_TESTS_V1.replace(
    'import { formatTemperature, formatWind } from "./forecast.mjs";',
    'import { formatTemperature, formatWind, nextTide, tidePath } from "./forecast.mjs";',
) + """
const tides = [
  { time: "03:12", heightM: 5.9, kind: "high" },
  { time: "09:26", heightM: 1.1, kind: "low" },
  { time: "15:38", heightM: 6.2, kind: "high" },
];

test("finds the next tide after now", () => {
  assert.equal(nextTide(tides, new Date("2026-11-18T10:00:00Z")).time, "15:38");
});

test("wraps to the first tide after the last one", () => {
  assert.equal(nextTide(tides, new Date("2026-11-18T23:00:00Z")).time, "03:12");
});

test("draws a path across the full width", () => {
  const path = tidePath(tides, 300, 80);
  assert.ok(path.startsWith("M0,"));
  assert.ok(path.includes("L300,"));
});
"""

TIDEPOOL_SERVER = """
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { forecast, formatTemperature, formatWind, nextTide } from "./forecast.mjs";

const page = await readFile(new URL("./public/index.html", import.meta.url));
const styles = await readFile(new URL("./public/styles.css", import.meta.url));

createServer((request, response) => {
  if (request.url === "/api/forecast") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ...forecast,
        temperature: formatTemperature(forecast.temperatureC),
        feelsLike: formatTemperature(forecast.feelsLikeC),
        wind: formatWind(forecast.windKmh, forecast.windDirection),
        nextTide: nextTide(forecast.tides, new Date()),
      }),
    );
    return;
  }
  if (request.url === "/styles.css") {
    response.writeHead(200, { "Content-Type": "text/css" });
    response.end(styles);
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(page);
}).listen(Number(process.env.PORT || 3801), "0.0.0.0");

console.log(`Tidepool running on http://localhost:${process.env.PORT || 3801}`);
"""

TIDEPOOL_HTML = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tidepool</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="card">
      <header>
        <p class="eyebrow">Coastal forecast</p>
        <h1 id="location">Loading…</h1>
      </header>
      <section class="now">
        <p class="temperature" id="temperature"></p>
        <p class="feels" id="feels"></p>
      </section>
      <dl class="stats">
        <div><dt>Wind</dt><dd id="wind"></dd></div>
        <div><dt>Swell</dt><dd id="swell"></dd></div>
        <div><dt>Next tide</dt><dd id="tide"></dd></div>
      </dl>
    </main>
    <script type="module">
      const forecast = await fetch("/api/forecast").then((response) => response.json());
      document.getElementById("location").textContent = forecast.location;
      document.getElementById("temperature").textContent = forecast.temperature;
      document.getElementById("feels").textContent = `Feels like ${forecast.feelsLike}`;
      document.getElementById("wind").textContent = forecast.wind;
      document.getElementById("swell").textContent = `${forecast.swellM} m`;
      document.getElementById("tide").textContent =
        `${forecast.nextTide.kind} at ${forecast.nextTide.time}`;
    </script>
  </body>
</html>
"""

TIDEPOOL_CSS = """
:root {
  color-scheme: light dark;
  --sea: #0f766e;
  --foam: #ecfdf5;
  --ink: #0f172a;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, var(--foam), #cffafe);
  color: var(--ink);
}

.card {
  width: min(420px, 90vw);
  padding: 32px;
  border-radius: 24px;
  background: white;
  box-shadow: 0 20px 50px rgb(15 118 110 / 0.15);
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sea);
}

h1 {
  margin: 4px 0 24px;
}

.temperature {
  margin: 0;
  font-size: 64px;
  font-weight: 600;
}

.feels {
  margin: 4px 0 24px;
  color: #475569;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 0;
}

.stats dt {
  font-size: 12px;
  color: #64748b;
}

.stats dd {
  margin: 4px 0 0;
  font-weight: 600;
  text-transform: capitalize;
}
"""

tidepool = [
    (
        "2026-11-03T09:12:00Z",
        "feat: scaffold Tidepool forecast app",
        {
            "package.json": json.dumps(
                {
                    "name": "tidepool",
                    "private": True,
                    "type": "module",
                    "scripts": {"dev": "node server.mjs", "test": "node --test"},
                },
                indent=2,
            )
            + "\n",
            "README.md": """
# Tidepool

A tiny coastal forecast for surfers and swimmers. It shows the temperature, wind, swell and the next tide for one beach.

```sh
npm run dev   # http://localhost:3801
npm test
```

No dependencies. Node 22 or newer.
""",
            ".gitignore": "node_modules/\n",
            "forecast.mjs": TIDEPOOL_FORECAST_V1,
            "forecast.test.mjs": TIDEPOOL_TESTS_V1,
        },
    ),
    (
        "2026-11-05T14:40:00Z",
        "feat: serve the forecast card",
        {
            "server.mjs": TIDEPOOL_SERVER,
            "public/index.html": TIDEPOOL_HTML,
            "public/styles.css": TIDEPOOL_CSS,
        },
    ),
    (
        "2026-11-10T11:05:00Z",
        "feat: show the next tide and add a tide curve helper",
        {"forecast.mjs": TIDEPOOL_FORECAST_V2, "forecast.test.mjs": TIDEPOOL_TESTS_V2},
    ),
]

PANTRY_RECIPES = [
    {
        "id": "shakshuka",
        "name": "Shakshuka",
        "serves": 2,
        "minutes": 30,
        "ingredients": [
            {"item": "eggs", "quantity": 4, "unit": "whole"},
            {"item": "crushed tomatoes", "quantity": 400, "unit": "g"},
            {"item": "red pepper", "quantity": 1, "unit": "whole"},
            {"item": "onion", "quantity": 1, "unit": "whole"},
            {"item": "cumin", "quantity": 1, "unit": "tsp"},
            {"item": "feta", "quantity": 60, "unit": "g"},
        ],
    },
    {
        "id": "miso-noodles",
        "name": "Miso butter noodles",
        "serves": 2,
        "minutes": 15,
        "ingredients": [
            {"item": "udon", "quantity": 400, "unit": "g"},
            {"item": "white miso", "quantity": 2, "unit": "tbsp"},
            {"item": "butter", "quantity": 30, "unit": "g"},
            {"item": "spring onion", "quantity": 2, "unit": "whole"},
        ],
    },
    {
        "id": "lentil-soup",
        "name": "Red lentil soup",
        "serves": 4,
        "minutes": 40,
        "ingredients": [
            {"item": "red lentils", "quantity": 250, "unit": "g"},
            {"item": "onion", "quantity": 1, "unit": "whole"},
            {"item": "crushed tomatoes", "quantity": 400, "unit": "g"},
            {"item": "vegetable stock", "quantity": 1, "unit": "l"},
            {"item": "cumin", "quantity": 2, "unit": "tsp"},
        ],
    },
]

pantry = [
    (
        "2026-11-04T18:30:00Z",
        "feat: add recipes and shopping list builder",
        {
            "package.json": json.dumps(
                {
                    "name": "pantry",
                    "private": True,
                    "type": "module",
                    "bin": {"pantry": "./cli.mjs"},
                    "scripts": {"start": "node cli.mjs", "test": "node --test"},
                },
                indent=2,
            )
            + "\n",
            "README.md": """
# Pantry

Plan a week of dinners and get one combined shopping list.

```sh
npm start -- shakshuka lentil-soup
npm test
```

Recipes live in `recipes.json`.
""",
            ".gitignore": "node_modules/\n",
            "recipes.json": json.dumps(PANTRY_RECIPES, indent=2) + "\n",
            "shopping.mjs": """
export function shoppingList(recipes) {
  const totals = new Map();
  for (const recipe of recipes) {
    for (const { item, quantity, unit } of recipe.ingredients) {
      const key = `${item}|${unit}`;
      totals.set(key, (totals.get(key) ?? 0) + quantity);
    }
  }
  return [...totals]
    .map(([key, quantity]) => {
      const [item, unit] = key.split("|");
      return { item, quantity, unit };
    })
    .sort((a, b) => a.item.localeCompare(b.item));
}

export function formatLine({ item, quantity, unit }) {
  return unit === "whole" ? `${quantity} × ${item}` : `${quantity} ${unit} ${item}`;
}
""",
            "shopping.test.mjs": """
import test from "node:test";
import assert from "node:assert/strict";
import { shoppingList, formatLine } from "./shopping.mjs";

const soup = { ingredients: [{ item: "onion", quantity: 1, unit: "whole" }] };
const salsa = {
  ingredients: [
    { item: "onion", quantity: 2, unit: "whole" },
    { item: "lime", quantity: 1, unit: "whole" },
  ],
};

test("combines the same ingredient across recipes", () => {
  assert.deepEqual(shoppingList([soup, salsa]), [
    { item: "lime", quantity: 1, unit: "whole" },
    { item: "onion", quantity: 3, unit: "whole" },
  ]);
});

test("formats whole items and measured items", () => {
  assert.equal(formatLine({ item: "eggs", quantity: 4, unit: "whole" }), "4 × eggs");
  assert.equal(formatLine({ item: "feta", quantity: 60, unit: "g" }), "60 g feta");
});
""",
            "cli.mjs": """
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { shoppingList, formatLine } from "./shopping.mjs";

const recipes = JSON.parse(await readFile(new URL("./recipes.json", import.meta.url), "utf8"));
const chosen = process.argv.slice(2);
const selected = chosen.length ? recipes.filter((recipe) => chosen.includes(recipe.id)) : recipes;

console.log(`Shopping list for ${selected.map((recipe) => recipe.name).join(", ")}\\n`);
for (const line of shoppingList(selected)) console.log(`  • ${formatLine(line)}`);
""",
        },
    ),
    (
        "2026-11-12T08:15:00Z",
        "docs: describe the recipe format",
        {
            "docs/recipes.md": """
# Recipe format

Each recipe in `recipes.json` has an `id`, a `name`, how many people it `serves`, the total `minutes` it takes, and a list of `ingredients`.

Units are `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, or `whole`.
""",
        },
    ),
]

LEDGER_CSV = """date,payee,category,amount
2026-10-01,Northside Rent,housing,-1450.00
2026-10-02,Acme Payroll,income,3820.00
2026-10-03,Green Grocer,groceries,-64.20
2026-10-05,City Transit,transport,-48.00
2026-10-07,Bean & Leaf,eating out,-9.80
2026-10-09,Green Grocer,groceries,-81.45
2026-10-11,PowerCo,utilities,-72.10
2026-10-12,Cinema Paradiso,fun,-24.00
2026-10-14,Bean & Leaf,eating out,-12.40
2026-10-16,Acme Payroll,income,3820.00
2026-10-17,Green Grocer,groceries,-58.90
2026-10-19,Noodle Bar,eating out,-31.50
2026-10-21,City Transit,transport,-48.00
2026-10-23,Bookshop on Main,fun,-18.99
2026-10-25,Green Grocer,groceries,-77.35
2026-10-27,FiberNet,utilities,-45.00
2026-10-29,Noodle Bar,eating out,-27.80
2026-10-31,Savings Transfer,savings,-800.00
"""

ledger = [
    (
        "2026-11-01T20:00:00Z",
        "feat: monthly spending summary",
        {
            "README.md": """
# Ledger

Summarise a month of bank transactions by category.

```sh
python3 ledger.py transactions.csv
python3 -m unittest
```

Standard library only. Python 3.11 or newer.
""",
            ".gitignore": "__pycache__/\n",
            "transactions.csv": LEDGER_CSV,
            "ledger.py": '''
import csv
import sys
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Transaction:
    date: str
    payee: str
    category: str
    amount: Decimal


def load(path):
    with open(path, newline="") as handle:
        return [
            Transaction(row["date"], row["payee"], row["category"], Decimal(row["amount"]))
            for row in csv.DictReader(handle)
        ]


def spending_by_category(transactions):
    totals = defaultdict(Decimal)
    for transaction in transactions:
        if transaction.amount < 0:
            totals[transaction.category] += -transaction.amount
    return dict(sorted(totals.items(), key=lambda item: item[1], reverse=True))


def income(transactions):
    return sum((t.amount for t in transactions if t.amount > 0), Decimal(0))


def main(path):
    transactions = load(path)
    spending = spending_by_category(transactions)
    total = sum(spending.values(), Decimal(0))
    print(f"Income   {income(transactions):>10,.2f}")
    print(f"Spending {total:>10,.2f}\\n")
    for category, amount in spending.items():
        share = amount / total * 100
        print(f"  {category:<12} {amount:>9,.2f}  {share:4.1f}%")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "transactions.csv")
''',
            "test_ledger.py": '''
import unittest
from decimal import Decimal

from ledger import Transaction, income, spending_by_category


def tx(category, amount):
    return Transaction("2026-10-01", "Payee", category, Decimal(amount))


class LedgerTest(unittest.TestCase):
    def test_groups_spending_by_category(self):
        result = spending_by_category([tx("food", "-10"), tx("food", "-5"), tx("fun", "-20")])
        self.assertEqual(result, {"fun": Decimal("20"), "food": Decimal("15")})

    def test_ignores_income_when_summing_spending(self):
        self.assertEqual(spending_by_category([tx("income", "100")]), {})

    def test_sums_income(self):
        self.assertEqual(income([tx("income", "100"), tx("food", "-5")]), Decimal("100"))


if __name__ == "__main__":
    unittest.main()
''',
        },
    ),
    (
        "2026-11-08T10:30:00Z",
        "feat: add monthly budgets",
        {
            "budgets.json": json.dumps(
                {
                    "groceries": 300,
                    "eating out": 80,
                    "transport": 120,
                    "fun": 60,
                    "utilities": 130,
                },
                indent=2,
            )
            + "\n",
        },
    ),
]

build("tidepool", tidepool, ["node", "--test"])
build("pantry", pantry, ["node", "--test"])
build("ledger", ledger, ["python3", "-m", "unittest", "-q"])
