(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRXCompanionMath = factory();
})(globalThis, function () {
  const MAX = BigInt(Number.MAX_SAFE_INTEGER);
  const decimal = '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]{1,6})?';
  const amountPattern = new RegExp(`^\\$?(${decimal})([kmb]?)$`, 'i');
  const percentPattern = /^([0-9]{1,6}(?:\.[0-9]{1,6})?)%?$/;
  const units = { '': 1n, k: 1000n, m: 1000000n, b: 1000000000n };
  const within = (n) => n >= 0n && n <= MAX;

  function fraction(text) {
    const [whole, decimals = ''] = text.replaceAll(',', '').split('.');
    return [BigInt(whole + decimals), 10n ** BigInt(decimals.length)];
  }

  function money(input) {
    const text = String(input).trim();
    if (text.length > 64) return null;
    const match = amountPattern.exec(text);
    if (!match) return null;
    const [value, scale] = fraction(match[1]);
    const scaled = value * units[match[2].toLowerCase()];
    return scaled % scale === 0n && within(scaled / scale) ? scaled / scale : null;
  }

  function percent(input, maximum = 100n) {
    const match = percentPattern.exec(String(input).trim());
    if (!match) return null;
    const [value, scale] = fraction(match[1]);
    return value <= maximum * scale ? [value, scale * 100n] : null;
  }

  function tradePlan({ wallet, current, reserve = '0', mode, direction, amount }) {
    const balance = money(wallet), offer = money(current), floor = money(reserve);
    if ([balance, offer, floor].includes(null) || !['add', 'withdraw'].includes(direction)) return { error: 'input' };
    let delta;
    if (mode === 'percent') {
      const ratio = percent(amount, direction === 'add' ? 999n : 100n);
      if (!ratio || ratio[0] === 0n || offer === 0n) return { error: 'percentage' };
      const rounded = (offer * ratio[0] + ratio[1] / 2n) / ratio[1];
      delta = rounded || 1n;
    } else if (mode === 'money') delta = money(amount);
    if (delta == null || delta === 0n) return { error: 'amount' };
    if (direction === 'withdraw' && delta > offer) return { error: 'withdraw', shortfall: Number(delta - offer) };
    const add = direction === 'add';
    const after = add ? balance - delta : balance + delta;
    const total = add ? offer + delta : offer - delta;
    if (add && after < floor) return { error: 'funds', shortfall: String(floor - after) };
    if (!within(after) || !within(total)) return { error: 'input' };
    return { delta: Number(delta), wallet: Number(after), offer: Number(total) };
  }

  function salePlan({ cost, price, fee = '0' }) {
    const buy = money(cost), sell = money(price), rate = percent(fee);
    if (buy == null || sell == null || !rate) return null;
    const feeAmount = (sell * rate[0] + rate[1] - 1n) / rate[1];
    return { net: Number(sell - feeAmount), profit: Number(sell - feeAmount - buy) };
  }

  function calculator(input) {
    if (input.length > 128) return null;
    const tokens = input.match(new RegExp(`\\$?${decimal}|[()+*%/−-]|\\s+|.`, 'gu')) || [];
    const parts = tokens.filter((token) => !/^\s+$/.test(token));
    if (parts.length > 64) return null;
    const values = [], ops = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, pos: 3 };
    function reduce() {
      const op = ops.pop(), b = values.pop();
      if (op === 'neg' || op === 'pos') { values.push(op === 'neg' ? -b : b); return; }
      const a = values.pop();
      values.push(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b);
    }
    let expectValue = true;
    for (const part of parts) {
      const token = part === '−' ? '-' : part;
      if (expectValue) {
        if (token === '(' || token === '+' || token === '-') {
          ops.push(token === '(' ? token : token === '-' ? 'neg' : 'pos');
        } else if (new RegExp(`^\\$?${decimal}$`).test(token)) {
          values.push(Number(token.replace(/[$,]/g, '')));
          expectValue = false;
        } else return null;
      } else if (token === '%') {
        values.push(values.pop() / 100);
      } else if (token === ')') {
        while (ops.length && ops.at(-1) !== '(') reduce();
        if (ops.pop() !== '(') return null;
      } else if (Object.hasOwn(precedence, token) && token.length === 1) {
        while (precedence[ops.at(-1)] >= precedence[token]) reduce();
        ops.push(token);
        expectValue = true;
      } else return null;
    }
    if (expectValue || ops.includes('(')) return null;
    while (ops.length) reduce();
    const result = values[0];
    return values.length === 1 && Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
  }

  function directorSummary(report) {
    const sales = (report.days ?? []).filter((row) => Number.isFinite(row.revenue));
    const last = sales.at(-1), previous = sales.at(-2);
    return {
      lowStock: report.products.filter((row) => Number.isFinite(row.daysLeft) && row.daysLeft < 1.5).length,
      efficiencyBelowGoal: Number.isFinite(report.company.efficiency) && report.company.efficiency < 90,
      environmentBelowGoal: Number.isFinite(report.company.environment) && report.company.environment < 100,
      dailyChange: previous && last ? last.revenue - previous.revenue : null,
    };
  }

  return { calculator, directorSummary, tradePlan, salePlan };
});
