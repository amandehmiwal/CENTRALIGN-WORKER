function createMockBrowserState() {
  return {
    page: 'inbox',
    invoices: [
      { id: 'portal-company-x-oct', vendor: 'Company X', invoiceId: 'INV-2026-091', amount: 48250, dueDate: '2026-10-28', received: '2026-10-12' },
      { id: 'portal-cloudfleet-oct', vendor: 'CloudFleet', invoiceId: 'CF-8872', amount: 126000, dueDate: '2026-10-20', received: '2026-10-13' }
    ],
    financeRecords: []
  };
}

function browserTool(browser, name, args) {
  if (name === 'browser_search_invoices') {
    browser.page = 'inbox';
    return browser.invoices.filter((invoice) => invoice.vendor.toLowerCase().includes(args.vendor.toLowerCase()));
  }
  if (name === 'browser_open_invoice') {
    const invoice = browser.invoices.find((item) => item.id === args.id);
    if (!invoice) throw Error('The browser portal could not open that invoice.');
    browser.page = `invoice/${invoice.id}`;
    return invoice;
  }
  if (name === 'browser_submit_finance') {
    const existing = browser.financeRecords.find((entry) => entry.invoiceId === args.invoiceId);
    if (existing) return { status: 'already_exists', entry: existing };
    const entry = { id: `browser-ledger-${browser.financeRecords.length + 1}`, ...args, status: 'saved' };
    browser.financeRecords.push(entry);
    browser.page = 'finance/records';
    return { status: 'created', entry };
  }
  if (name === 'browser_verify_finance') {
    const entry = browser.financeRecords.find((item) => item.invoiceId === args.invoiceId);
    return { verified: Boolean(entry && entry.amount === args.amount && entry.dueDate === args.dueDate), entry: entry || null };
  }
  throw Error(`Unknown browser tool: ${name}`);
}

module.exports = { browserTool, createMockBrowserState };
