// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import '../extension/core.js';

const require = createRequire(import.meta.url);
const { initializeAutoPreviews } = require('../vscode/settings.js');
const manifest = require('../vscode/package.json');
const VIEW = 'octoview.preview';

function settings({ selected = [], associations, workspaceAssociations = {} } = {}) {
  const listeners = new Set();
  const storage = new Map();
  const state = {
    selected,
    associations,
    workspaceAssociations,
    configurationFailures: 0,
    storageFailures: 0,
    messages: [],
  };
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    workspace: {
      getConfiguration: (section) => ({
        get: (name, fallback) => {
          if (section === 'octoview' && name === 'autoPreviewFileTypes') return state.selected;
          if (section === 'workbench' && name === 'editorAssociations') {
            return { ...state.associations, ...state.workspaceAssociations };
          }
          return fallback;
        },
        inspect: () => ({
          globalValue: structuredClone(state.associations),
          workspaceValue: state.workspaceAssociations,
        }),
        update: async (name, value, target) => {
          if (section !== 'workbench' || name !== 'editorAssociations' || target !== 1) {
            throw new Error('Unexpected configuration target');
          }
          await Promise.resolve();
          if (state.configurationFailures > 0) {
            state.configurationFailures--;
            throw new Error('Settings file is read-only');
          }
          state.associations = structuredClone(value);
        },
      }),
      onDidChangeConfiguration: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    window: {
      showErrorMessage: (message) => {
        state.messages.push(message);
      },
    },
  };
  const context = {
    subscriptions: [],
    globalState: {
      get: (key, fallback) => structuredClone(storage.get(key) ?? fallback),
      update: async (key, value) => {
        await Promise.resolve();
        if (state.storageFailures > 0) {
          state.storageFailures--;
          throw new Error('Storage is unavailable');
        }
        storage.set(key, structuredClone(value));
      },
    },
  };
  return {
    state,
    start: () => initializeAutoPreviews(vscode, context),
    change: (value) => {
      state.selected = value;
      return Promise.all(
        [...listeners].map((listener) =>
          listener({
            affectsConfiguration: (key) => key === 'octoview.autoPreviewFileTypes',
          })
        )
      );
    },
    dispose: () =>
      context.subscriptions.splice(0).forEach((subscription) => subscription.dispose()),
  };
}

describe('automatic preview settings', () => {
  it('offers every supported format and defaults to manual previews', async () => {
    const setting = manifest.contributes.configuration.properties['octoview.autoPreviewFileTypes'];
    expect(setting.default).toEqual([]);
    expect([...setting.items.enum].sort()).toEqual([...globalThis.octoview.SUPPORTED].sort());
    const host = settings();
    await host.start();
    expect(host.state.associations).toBeUndefined();
    host.dispose();
  });

  it('opens selected file types automatically through native associations', async () => {
    const host = settings({
      selected: ['.parquet', '.npy'],
      associations: { '*.png': 'imagePreview.previewEditor' },
    });
    await host.start();
    expect(host.state.associations).toEqual({
      '*.png': 'imagePreview.previewEditor',
      '*.parquet': VIEW,
      '*.npy': VIEW,
    });
    host.dispose();
  });

  it('removes deselected formats while keeping other automatic previews', async () => {
    const host = settings();
    await host.start();
    await host.change(['.parquet', '.npy']);
    await host.change(['.npy']);
    expect(host.state.associations).toEqual({ '*.npy': VIEW });
    host.dispose();
  });

  it('preserves an existing editor choice for the same filename pattern', async () => {
    const host = settings({ associations: { '*.parquet': 'another.preview' } });
    await host.start();
    await host.change(['.parquet']);
    expect(host.state.associations).toEqual({ '*.parquet': 'another.preview' });
    await host.change([]);
    expect(host.state.associations).toEqual({ '*.parquet': 'another.preview' });
    host.dispose();
  });

  it('keeps Octoview associations the user created independently', async () => {
    const host = settings({ associations: { '*.parquet': VIEW } });
    await host.start();
    await host.change(['.parquet']);
    await host.change([]);
    expect(host.state.associations).toEqual({ '*.parquet': VIEW });
    host.dispose();
  });

  it('preserves manual changes made after enabling automatic previews', async () => {
    const host = settings();
    await host.start();
    await host.change(['.parquet', '.npy']);
    host.state.associations['*.parquet'] = 'another.preview';
    await host.change([]);
    expect(host.state.associations).toEqual({ '*.parquet': 'another.preview' });
    host.dispose();
  });

  it('does not copy workspace associations into user settings', async () => {
    const workspaceAssociations = {
      '*.ipynb': 'jupyter-notebook',
      '*.parquet': 'workspace.preview',
    };
    const host = settings({ workspaceAssociations });
    await host.start();
    await host.change(['.parquet']);
    expect(host.state.associations).toEqual({ '*.parquet': VIEW });
    expect(host.state.workspaceAssociations).toEqual(workspaceAssociations);
    host.dispose();
  });

  it('retains managed preferences across extension restarts', async () => {
    const host = settings({ selected: ['.parquet'] });
    await host.start();
    host.dispose();
    await host.start();
    await host.change([]);
    expect(host.state.associations).toBeUndefined();
    host.dispose();
  });

  it('reports a failed settings write and can retry after restart', async () => {
    const host = settings({ selected: ['.parquet'] });
    host.state.configurationFailures = 1;
    await host.start();
    expect(host.state.associations).toBeUndefined();
    expect(host.state.messages.join('\n')).toMatch(/read-only/);
    host.dispose();
    await host.start();
    expect(host.state.associations).toEqual({ '*.parquet': VIEW });
    await host.change([]);
    expect(host.state.associations).toBeUndefined();
    host.dispose();
  });

  it('can finish disabling previews after a failed settings write', async () => {
    const host = settings({ selected: ['.parquet'] });
    await host.start();
    host.state.configurationFailures = 1;
    await host.change([]);
    expect(host.state.associations).toEqual({ '*.parquet': VIEW });
    await host.change([]);
    expect(host.state.associations).toBeUndefined();
    host.dispose();
  });

  it('reports storage failures without losing the user settings', async () => {
    const host = settings({ selected: ['.parquet'], associations: { '*.png': 'image.preview' } });
    host.state.storageFailures = 1;
    await host.start();
    expect(host.state.associations).toEqual({ '*.png': 'image.preview' });
    expect(host.state.messages.join('\n')).toMatch(/Storage/);
    await host.change(['.parquet']);
    expect(host.state.associations).toEqual({ '*.png': 'image.preview', '*.parquet': VIEW });
    host.dispose();
  });

  it('applies the latest choice when settings change during synchronization', async () => {
    const host = settings();
    await host.start();
    const enabling = host.change(['.parquet']);
    await Promise.resolve();
    const disabling = host.change([]);
    await Promise.all([enabling, disabling]);
    expect(host.state.associations).toBeUndefined();
    expect(host.state.messages).toEqual([]);
    host.dispose();
  });

  it('rejects unsupported extensions without changing editor preferences', async () => {
    const host = settings({
      selected: ['.unsupported'],
      associations: { '*.png': 'image.preview' },
    });
    await host.start();
    expect(host.state.associations).toEqual({ '*.png': 'image.preview' });
    expect(host.state.messages.join('\n')).toMatch(/supported file extensions/);
    host.dispose();
  });
});
