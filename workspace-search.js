const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// The user chooses this root before launch. The worker cannot read outside it.
const workspaceRoot = path.resolve(process.env.CENTRA_WORKSPACE_DIR || path.join(__dirname, 'workspace'));
const supportedExtensions = new Set(['.txt', '.md', '.csv', '.json', '.html', '.xml', '.log', '.pdf', '.docx', '.xlsx']);
const ignoredDirectories = new Set(['.git', 'node_modules', '.DS_Store']);
const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'from', 'find', 'latest', 'please', 'tell', 'me', 'what', 'is', 'in', 'of', 'to', 'it', 'our', 'my', 'with', 'for', 'into', 'system']);

function listFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(fullPath, files);
    else if (supportedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function tokens(input) {
  return input.toLowerCase().match(/[a-z0-9]{2,}/g)?.filter((word) => !stopWords.has(word)) || [];
}

function extractText(fullPath) {
  const extension = path.extname(fullPath).toLowerCase();
  if (!['.pdf', '.docx', '.xlsx'].includes(extension)) return fs.readFileSync(fullPath, 'utf8');

  try {
    if (extension === '.pdf') return execFileSync('pdftotext', [fullPath, '-'], { encoding: 'utf8', timeout: 5000 });
    const archiveContents = extension === '.docx'
      ? execFileSync('unzip', ['-p', fullPath, 'word/document.xml'], { encoding: 'utf8', timeout: 5000 })
      : execFileSync('unzip', ['-p', fullPath, 'xl/sharedStrings.xml', 'xl/worksheets/*.xml'], { encoding: 'utf8', timeout: 5000 });
    return archiveContents.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}

function excerpt(text, queryTokens) {
  const lower = text.toLowerCase();
  const index = queryTokens.map((token) => lower.indexOf(token)).find((position) => position >= 0) ?? 0;
  return text.replace(/\s+/g, ' ').slice(Math.max(0, index - 80), index + 260).trim();
}

function parseInvoice(text, relativePath) {
  const invoiceId = text.match(/(?:invoice\s*(?:number|no\.?|#|id)?\s*[:#-]?\s*)([A-Z]{2,}[A-Z0-9-]+)/i)?.[1] || path.basename(relativePath, path.extname(relativePath)).toUpperCase();
  const amountText = text.match(/(?:total\s*(?:amount)?|amount\s*due|invoice\s*amount)\s*[:₹$]?\s*(?:₹|\$)?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const dueDate = text.match(/(?:due\s*date|payment\s*due|due)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
  const vendor = text.match(/(?:vendor|company|supplier)\s*[:\-]\s*([^\n\r]+)/i)?.[1]?.trim();
  if (!amountText || !dueDate) return null;
  return { invoiceId, amount: Number(amountText.replace(/,/g, '')), dueDate, vendor, currency: /\$|USD/i.test(text) ? 'USD' : 'INR' };
}

function searchWorkspace(query) {
  const queryTokens = tokens(query);
  const results = [];
  for (const fullPath of listFiles(workspaceRoot)) {
    const stat = fs.statSync(fullPath);
    if (stat.size > 2_000_000) continue;
    const text = extractText(fullPath);
    const searchable = `${path.basename(fullPath)} ${text}`.toLowerCase();
    const score = queryTokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);
    if (score === 0) continue;
    const relativePath = path.relative(workspaceRoot, fullPath);
    results.push({ path: relativePath, modifiedAt: stat.mtime.toISOString(), score, excerpt: excerpt(text, queryTokens), invoice: /invoice|amount|due\s*date/i.test(query) ? parseInvoice(text, relativePath) : null });
  }
  return results.sort((left, right) => right.score - left.score || right.modifiedAt.localeCompare(left.modifiedAt));
}

function workspaceInfo() {
  return { root: workspaceRoot, fileCount: listFiles(workspaceRoot).length, supportedExtensions: [...supportedExtensions] };
}

module.exports = { searchWorkspace, workspaceInfo };
