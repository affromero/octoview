import { describe, expect, it } from 'vitest';
import { int32, tableFromArrays, tableToIPC, utf8 } from '@uwdata/flechette';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { renderTable } from '../extension/render-table.js';

describe('table previews', () => {
  it('shows the schema of an empty Arrow table', async () => {
    const table = tableFromArrays({ id: [], name: [] }, { schema: { id: int32(), name: utf8() } });
    const bytes = tableToIPC(table);
    const mount = document.createElement('div');
    await renderTable(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      mount,
      '.arrow'
    );
    expect(mount.querySelector('.ov-tbl-meta').textContent).toContain('0 rows × 2 cols');
    expect([...mount.querySelectorAll('thead td')].map((cell) => cell.textContent)).toEqual([
      '#',
      'id',
      'name',
    ]);
  });

  it('limits wide schemas while reporting the total number of columns', async () => {
    const arrays = Object.fromEntries(Array.from({ length: 120 }, (_, i) => ['field' + i, []]));
    const schema = Object.fromEntries(Object.keys(arrays).map((name) => [name, int32()]));
    const bytes = tableToIPC(tableFromArrays(arrays, { schema }));
    const mount = document.createElement('div');
    await renderTable(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      mount,
      '.arrow'
    );
    expect(mount.querySelector('.ov-tbl-meta').textContent).toContain('0 rows × 120 cols');
    expect(mount.querySelector('.ov-tbl-meta').textContent).toContain('first 100 columns');
    expect(mount.querySelectorAll('thead td')).toHaveLength(101);
  });

  it('shows column names for empty Parquet data', async () => {
    const bytes = parquetWriteBuffer({
      columnData: [
        { name: 'id', type: 'INT32', data: [] },
        { name: 'name', type: 'STRING', data: [] },
      ],
    });
    const mount = document.createElement('div');
    await renderTable(bytes, mount, '.parquet');
    expect(mount.textContent).toContain('0 rows × 2 cols');
    expect(mount.querySelector('thead').textContent).toContain('idname');
  });

  it('shows nested Parquet columns and later top-level fields', async () => {
    const bytes = parquetWriteBuffer({
      schema: [
        { name: 'schema', num_children: 2 },
        { name: 'item', num_children: 2, repetition_type: 'REQUIRED' },
        { name: 'count', type: 'INT32', repetition_type: 'REQUIRED' },
        { name: 'weight', type: 'INT32', repetition_type: 'REQUIRED' },
        { name: 'label', type: 'INT32', repetition_type: 'REQUIRED' },
      ],
      columnData: [
        { name: 'item', data: [{ count: 7, weight: 12 }] },
        { name: 'label', data: [42] },
      ],
    });
    const mount = document.createElement('div');
    await renderTable(bytes, mount, '.parquet');
    expect(mount.textContent).toContain('1 rows × 2 cols');
    expect(mount.querySelector('thead').textContent).toContain('itemlabel');
    expect(mount.querySelector('tbody').textContent).toContain('42');
    expect(mount.querySelector('tbody').textContent).toContain('"count":7');
  });

  it('projects populated Parquet data to the first 100 columns', async () => {
    const columnData = Array.from({ length: 120 }, (_, i) => ({
      name: 'field' + i,
      type: 'INT32',
      data: [i],
    }));
    const mount = document.createElement('div');
    await renderTable(parquetWriteBuffer({ columnData }), mount, '.parquet');
    expect(mount.textContent).toContain('1 rows × 120 cols');
    expect(mount.querySelectorAll('thead td')).toHaveLength(101);
    expect(mount.querySelectorAll('tbody td')).toHaveLength(101);
    expect(mount.querySelector('tbody').textContent).toContain('99');
  });

  it('rejects a nested Parquet field with too many leaf columns', async () => {
    const entries = Array.from({ length: 101 }, (_, i) => ['field' + i, i]);
    const schema = [
      { name: 'schema', num_children: 1 },
      { name: 'item', num_children: entries.length, repetition_type: 'REQUIRED' },
      ...entries.map(([name]) => ({ name, type: 'INT32', repetition_type: 'REQUIRED' })),
    ];
    const columnData = [{ name: 'item', data: [Object.fromEntries(entries)] }];
    const mount = document.createElement('div');
    await renderTable(parquetWriteBuffer({ schema, columnData }), mount, '.parquet');
    expect(mount.textContent).toContain('too many nested columns to preview');
  });
});
