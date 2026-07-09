// octoview tabular renderer, lazy-imported inline for .parquet. hyparquet is pure
// JS (no workers) and reads the file bytes directly, so it is WebKit safe. Shows
// the schema line plus the first rows as a scrollable table.
import { parquetReadObjects, parquetMetadata } from './vendor/hyparquet.esm.js';

const LIMIT = 200;

export async function renderTable(buf, mount, _ext) {
  mount.textContent = '';
  try {
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
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
