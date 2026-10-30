const manifest = require('./package.json');

const SETTING = 'autoPreviewFileTypes';
const OWNED_KEY = 'managedAutoPreviewAssociations';
const editor = manifest.contributes.customEditors[0];
const supported = new Set(editor.selector.map(({ filenamePattern }) => filenamePattern.slice(1)));

function planAssociations(selected, current, managed) {
  if (!Array.isArray(selected) || selected.some((ext) => !supported.has(ext))) {
    throw new Error('Auto Preview File Types must contain supported file extensions.');
  }
  const desired = new Set(selected.map((ext) => '*' + ext));
  const associations = { ...current };
  const owned = new Set(managed);
  for (const pattern of owned) {
    if (desired.has(pattern)) continue;
    if (associations[pattern] === editor.viewType) delete associations[pattern];
    owned.delete(pattern);
  }
  for (const pattern of desired) {
    // Native choices, including Octoview entries created outside this setting,
    // belong to the user and are never claimed or overwritten here.
    if (associations[pattern] !== undefined) continue;
    associations[pattern] = editor.viewType;
    owned.add(pattern);
  }
  return { associations, managed: [...owned].sort() };
}

async function synchronize(vscode, context) {
  const selected = vscode.workspace.getConfiguration('octoview').get(SETTING, []);
  const configuration = vscode.workspace.getConfiguration('workbench');
  // Read user settings only, so workspace entries are never copied into them.
  const current = configuration.inspect('editorAssociations').globalValue || {};
  const previous = context.globalState.get(OWNED_KEY, []);
  const next = planAssociations(selected, current, previous);
  const associationsChanged = JSON.stringify(current) !== JSON.stringify(next.associations);
  let saved = previous;
  if (associationsChanged) {
    // Retain ownership until the settings write succeeds. If it fails or the
    // process exits, a subsequent synchronization can retry without losing it.
    const pending = [...new Set([...previous, ...next.managed])].sort();
    if (JSON.stringify(previous) !== JSON.stringify(pending)) {
      await context.globalState.update(OWNED_KEY, pending);
      saved = pending;
    }
    await configuration.update(
      'editorAssociations',
      Object.keys(next.associations).length ? next.associations : undefined,
      vscode.ConfigurationTarget.Global
    );
  }
  if (JSON.stringify(saved) !== JSON.stringify(next.managed)) {
    await context.globalState.update(OWNED_KEY, next.managed);
  }
}

function initializeAutoPreviews(vscode, context) {
  let pending = Promise.resolve();
  const enqueue = () => {
    pending = pending
      .then(() => synchronize(vscode, context))
      .catch((error) => {
        vscode.window.showErrorMessage(
          'Could not configure Octoview automatic previews: ' + error.message
        );
      });
    return pending;
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('octoview.' + SETTING)) return enqueue();
    })
  );
  return enqueue();
}

module.exports = { initializeAutoPreviews };
