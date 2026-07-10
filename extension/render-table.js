// octoview tabular renderer, lazy-imported inline for .parquet (hyparquet) and
// .arrow/.feather/.ipc (flechette). Both are pure JS (no workers), WebKit safe.
// Shows the schema line plus the first rows as a scrollable table.
import { parquetReadObjects, parquetMetadata } from './vendor/hyparquet.esm.js';
import { tableFromIPC } from './vendor/flechette.esm.js';

const LIMIT = 200;
const ARROW_EXTS = ['.arrow', '.feather', '.ipc'];

async function readRows(buf, ext) {
  if (ARROW_EXTS.includes(ext)) {
    const table = tableFromIPC(new Uint8Array(buf));
    const totalRows = table.numRows;
    const names = table.names;
    const rows = [];
    const limit = Math.min(LIMIT, totalRows);
    const cols = names.map((n) => table.getChild(n));
    for (let i = 0; i < limit; i++)
      rows.push(Object.fromEntries(names.map((n, c) => [n, cols[c].at(i)])));
    return { totalRows, rows };
  }
  const meta = parquetMetadata(buf);
  const totalRows = Number(meta.num_rows);
  const file = {
    byteLength: buf.byteLength,
    slice: (s, e) => buf.slice(s, e ?? buf.byteLength),
  };
  const rows = await parquetReadObjects({
    metadata: meta,
    file,
    rowStart: 0,
    rowEnd: Math.min(LIMIT, totalRows),
  });
  return { totalRows, rows };
}

export async function renderTable(buf, mount, ext) {
  mount.textContent = '';
  try {
    const { totalRows, rows } = await readRows(buf, ext);
    const cols = rows.length ? Object.keys(rows[0]) : [];

    const info = document.createElement('div');
    info.className = 'ov-tbl-meta';
    info.textContent =
      `${totalRows.toLocaleString()} rows × ${cols.length} cols` +
      (totalRows > LIMIT ? `  ·  showing first ${LIMIT}` : '');
    mount.appendChild(info);

    const scroll = document.createElement('div');
    scroll.className = 'ov-tbl-scroll';
    const table = document.createElement('table');
    table.className = 'ov-tbl';
    const thead = table.createTHead().insertRow();
    thead.insertCell().textContent = '#';
    for (const c of cols) thead.insertCell().textContent = c;
    const tbody = table.createTBody();
    rows.forEach((row, i) => {
      const tr = tbody.insertRow();
      const idx = tr.insertCell();
      idx.textContent = i;
      idx.className = 'ov-tbl-idx';
      for (const c of cols) tr.insertCell().textContent = cell(row[c]);
    });
    scroll.appendChild(table);
    mount.appendChild(scroll);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = 'Table preview failed: ' + ((e && e.message) || e);
    mount.appendChild(p);
  }
}

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  // Nested BigInt (LIST<INT64>, STRUCT with int64 fields) would throw in
  // JSON.stringify, so coerce it in a replacer.
  if (typeof v === 'object')
    return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
  return String(v);
}
