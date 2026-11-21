import { describe, it, expect, vi } from 'vitest';
import ContextCardsPlugin from '../src/main';
import { VIEW_TYPE } from '../src/view';
import { WRITING_VIEW } from '../src/writing-view';
function setup(types: string[]) {
  const leaves = types.map((type) => ({
    type,
    view: { type },
    setViewState: vi.fn(async function (this: any, state: any) {
      this.type = state.type;
      this.view = { type: state.type };
    }),
    detach: vi.fn(),
  }));
  const workspace = {
    getLeavesOfType: (type: string) =>
      leaves.filter((l) => l.type === type && !l.detach.mock.calls.length),
    getRightLeaf: vi.fn(),
    getLeaf: vi.fn(),
    revealLeaf: vi.fn(),
  };
  const plugin = new ContextCardsPlugin({ workspace } as any, {} as any);
  return { plugin, workspace, leaves };
}
describe('shared mode pane', () => {
  it('reuses vocabulary pane when opening writing instead of splitting the sidebar', async () => {
    const { plugin, workspace, leaves } = setup([VIEW_TYPE]);
    await plugin.openWritingPanel();
    expect(leaves[0]!.type).toBe(WRITING_VIEW);
    expect(workspace.getRightLeaf).not.toHaveBeenCalled();
    await plugin.openPanel();
    expect(leaves[0]!.type).toBe(VIEW_TYPE);
    expect(leaves[0]!.detach).not.toHaveBeenCalled();
  });
  it('removes obsolete stacked plugin panes when the requested mode is already open', async () => {
    const { plugin, leaves } = setup([VIEW_TYPE, WRITING_VIEW, 'third-party-view']);
    await plugin.openWritingPanel();
    expect(leaves[0]!.detach).toHaveBeenCalledOnce();
    expect(leaves[1]!.detach).not.toHaveBeenCalled();
    expect(leaves[2]!.detach).not.toHaveBeenCalled();
  });
  it('serializes simultaneous mode switches and keeps both draft collections', async () => {
    const { plugin, leaves } = setup([VIEW_TYPE]);
    const drafts = plugin.drafts,
      sessions = plugin.writing.sessions;
    await Promise.all([plugin.openWritingPanel(), plugin.openPanel()]);
    expect(leaves[0]!.type).toBe(VIEW_TYPE);
    expect(plugin.drafts).toBe(drafts);
    expect(plugin.writing.sessions).toBe(sessions);
  });
});
