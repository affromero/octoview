// Run with VS Code's --extensionTestsPath. This exercises the real extension host.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

async function waitFor(condition) {
  const deadline = Date.now() + 30000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for preview settings');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function verifyParquetContents() {
  const port = process.env.OCTOVIEW_TEST_CDP_PORT;
  if (!port) return;
  const { chromium } = require('playwright');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  try {
    let contentFrame;
    await waitFor(async () => {
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          for (const frame of page.frames()) {
            if (!(await frame.locator('#filename').count())) continue;
            if ((await frame.locator('#filename').innerText()) !== 'metrics.parquet') continue;
            contentFrame = frame;
            return true;
          }
        }
      }
      return false;
    });
    await contentFrame.locator('#status').waitFor({ state: 'hidden' });
    const text = await contentFrame.locator('#mount').innerText();
    assert.match(text, /500 rows/);
    assert.match(text, /accuracy/);
    console.log('PASS: native automatic Parquet preview renders table contents');
  } finally {
    await browser.close();
  }
}

module.exports.run = async () => {
  const extension = vscode.extensions.getExtension('affromero.octoview');
  assert.ok(extension, 'Octoview is installed in the development host');
  await waitFor(() => extension.isActive);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('octoview.openPreview'));
  const root = path.resolve(extension.extensionPath, '..', '..');
  const preferences = vscode.workspace.getConfiguration('octoview');
  const workbench = vscode.workspace.getConfiguration('workbench');
  const previousTypes = preferences.inspect('autoPreviewFileTypes').globalValue;
  const previousAssociations = workbench.inspect('editorAssociations').globalValue;
  const associations = () => workbench.inspect('editorAssociations').globalValue || {};
  try {
    assert.deepEqual(preferences.get('autoPreviewFileTypes'), []);
    await preferences.update(
      'autoPreviewFileTypes',
      ['.parquet'],
      vscode.ConfigurationTarget.Global
    );
    await waitFor(() => associations()['*.parquet'] === 'octoview.preview');
    const parquet = vscode.Uri.file(path.join(root, 'samples', 'metrics.parquet'));
    await vscode.commands.executeCommand('vscode.open', parquet);
    const preview = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(preview.input instanceof vscode.TabInputCustom, 'Normal Parquet opens use Octoview');
    assert.equal(preview.input.viewType, 'octoview.preview');
    assert.equal(preview.input.uri.toString(), parquet.toString());
    await verifyParquetContents();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await preferences.update('autoPreviewFileTypes', [], vscode.ConfigurationTarget.Global);
    await waitFor(() => associations()['*.parquet'] === undefined);
    await vscode.commands.executeCommand(
      'vscode.open',
      vscode.Uri.file(path.join(root, 'samples', 'report.html'))
    );
    assert.ok(
      vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputText,
      'Manual mode keeps the normal text editor'
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } finally {
    await preferences.update('autoPreviewFileTypes', [], vscode.ConfigurationTarget.Global);
    await waitFor(() => associations()['*.parquet'] === undefined);
    await workbench.update(
      'editorAssociations',
      previousAssociations,
      vscode.ConfigurationTarget.Global
    );
    await preferences.update(
      'autoPreviewFileTypes',
      previousTypes,
      vscode.ConfigurationTarget.Global
    );
  }
  for (const name of ['metrics.parquet', 'array.npy', 'notebook.ipynb', 'lcc/meta.lcc']) {
    const uri = vscode.Uri.file(path.join(root, 'samples', name));
    await vscode.commands.executeCommand('octoview.openPreview', uri);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab.input instanceof vscode.TabInputCustom, 'Preview uses a custom editor');
    assert.equal(tab.input.viewType, 'octoview.preview');
    assert.equal(tab.input.uri.toString(), uri.toString());
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  console.log(
    'PASS: VS Code startup, automatic Parquet preview, opt-out, manual preview, and tab lifecycle'
  );
};
