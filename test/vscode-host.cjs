// Run with VS Code's --extensionTestsPath. This exercises the real extension host.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

module.exports.run = async () => {
  const extension = vscode.extensions.getExtension('affromero.octoview');
  assert.ok(extension, 'Octoview is installed in the development host');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('octoview.openPreview'));
  const root = path.resolve(extension.extensionPath, '..', '..');
  for (const name of ['metrics.parquet', 'array.npy', 'notebook.ipynb', 'lcc/meta.lcc']) {
    const uri = vscode.Uri.file(path.join(root, 'samples', name));
    await vscode.commands.executeCommand('octoview.openPreview', uri);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab.input instanceof vscode.TabInputCustom, 'Preview uses a custom editor');
    assert.equal(tab.input.viewType, 'octoview.preview');
    assert.equal(tab.input.uri.toString(), uri.toString());
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  console.log('PASS: VS Code activation, preview command, custom editor, and tab lifecycle');
};
