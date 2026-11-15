// Synthetic company report for the Employees page, shaped like buildCompanyReport() in src/server/server.js.
// Invented names and numbers only: no player, company or Torn data.
const { stockCompany } = require('./stock-fixture');

const DAY = 86_400_000;

// [id, name, position, addiction, effectiveness total, status state, last action]
const DEFAULT_STAFF = [
  [9000001, 'Fixture_Ava', 'Model', -11, 96, 'Okay', 'Online'],
  [9000002, 'Fixture_Ben', 'Sales Assistant', -9, 104, 'Abroad', 'Idle'],
  [9000003, 'Fixture_Cleo', 'Stock Clerk', -8, 88, 'Hospital', 'Offline'],
  [9000004, 'Fixture_Dan', 'Model', -6, 112, 'Okay', 'Online'],
  [9000005, 'Fixture_Eve', 'Manager', -3, 131, 'Okay', 'Offline'],
  [9000006, 'Fixture_Finn', 'Sales Assistant', 0, 118, 'Traveling', 'Offline'],
  [9000007, 'Fixture_Gus', 'Stock Clerk', 0, 99, 'Okay', 'Idle'],
  [9000008, 'Fixture_Hana', 'Model', 2, 124, 'Okay', 'Online'],
];

function employee([id, name, position, addiction, total, state, action], i, now) {
  const history = Array.from({ length: 10 }, (_, d) => ({ t: now - (9 - d) * DAY, value: Math.min(0, Math.round(addiction * (d + 1) / 10)) }));
  return {
    id, name, position, days: 40 + i * 37, wage: 45000 + i * 5000,
    manual_labor: 12000 + i * 1500, intelligence: 9000 + i * 900, endurance: 15000 + i * 1100,
    effectiveness: { working_stats: total - 30, settled_in: 10, merits: 10, director_education: 10, addiction, total },
    addiction, inactivity: i === 2 ? -4 : 0,
    lastAction: { status: action, relative: action === 'Online' ? '2 minutes ago' : `${i + 1} hours ago`, timestamp: Math.floor((now - (i + 1) * 3600_000) / 1000) },
    status: state === 'Abroad'
      ? { state, description: 'In Switzerland', until: 0 }
      : state === 'Hospital' ? { state, description: 'In hospital for 41 mins', until: Math.floor((now + 41 * 60_000) / 1000) }
        : { state, description: state === 'Traveling' ? 'Traveling to Mexico' : 'Okay', until: 0 },
    addictionHistory: addiction < 0 ? history : [],
  };
}

function employeesCompany({ now = Date.now(), staff = DEFAULT_STAFF } = {}) {
  const c = stockCompany({ now });
  const employees = staff.map((row, i) => employee(row, i, now)).sort((a, b) => a.addiction - b.addiction);
  const wages = employees.reduce((a, e) => a + e.wage, 0);
  return {
    ...c,
    company: { ...c.company, hired: employees.length, capacity: 10 },
    employees,
    income: { ...c.income, wages, net: c.income.revenue - c.income.cogs - wages - c.income.ads },
  };
}

module.exports = { employeesCompany, DEFAULT_STAFF };
