/**
 * Tools and materials counted: the "How many?" box on the tool form and the issue / return form, the messages when
 * the count does not allow it, and a material with nothing in store still having its row on the Tools tab.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import ToolsScreen from '@/app/(tabs)/tools';
import ToolForm from '@/app/tool/form';
import ToolMove from '@/app/tool/move';
import { setSetting } from '@/db';
import { moveTool, saveProject, saveTool, saveWorker } from '@/db/repo';
import { resetDb } from '@/test-utils';
import { rows, setCurrent } from '@/test-utils/screenData';
import { hasLabel, inputValue, makeTr, pressLabel, renderScreen, screen, setRouteParams, typeInto, visibleText } from '@/test-utils/screenKit';

const E = makeTr('en');

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  setCurrent(null);
});

const tools = (name: string) => rows<{ quantity_milli: number; is_material: number; unit: string | null }>('SELECT quantity_milli, is_material, unit FROM tools WHERE name = ? AND deleted_at IS NULL', [name]);
const movements = () => rows<{ kind: string; qty_milli: number }>('SELECT kind, qty_milli FROM tool_movements WHERE deleted_at IS NULL ORDER BY created_at');

describe('the tool form: How many?', () => {
  it('a new tool with 10 is saved as ten pieces', async () => {
    await renderScreen(<ToolForm />);
    expect(inputValue(E('howMany'))).toBe('1'); // starts at one piece, as every tool always was
    await typeInto(E('toolName'), 'Ladder');
    await typeInto(E('howMany'), '10');
    await pressLabel(E('save'));
    expect(tools('Ladder')).toEqual([{ quantity_milli: 10_000, is_material: 0, unit: null }]);
  });

  it('an empty or unreadable count is an error under the box; nothing is saved and nothing is quietly set to one', async () => {
    await renderScreen(<ToolForm />);
    await typeInto(E('toolName'), 'Ladder');
    await typeInto(E('howMany'), '');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errQty'));
    expect(tools('Ladder')).toEqual([]);
    await typeInto(E('howMany'), '2.5.');
    await pressLabel(E('save'));
    expect(tools('Ladder')).toEqual([]);
    await typeInto(E('howMany'), '2.5'); // a tool is counted in whole pieces
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errQtyWhole'));
    expect(tools('Ladder')).toEqual([]);
  });

  it('a material has a unit, may be counted in decimals, and may start at 0', async () => {
    await renderScreen(<ToolForm />);
    await typeInto(E('toolName'), 'Sand');
    await pressLabel(E('kindMaterial'));
    await typeInto(E('howMany'), '0');
    await typeInto(E('unit'), 'tons');
    await pressLabel(E('save'));
    expect(tools('Sand')).toEqual([{ quantity_milli: 0, is_material: 1, unit: 'tons' }]);
  });
});

describe('the issue form: How many?', () => {
  function setup() {
    const project = saveProject({ name: 'Alpha Site' });
    const ladder = saveTool({ name: 'Ladder', quantity_milli: 10_000 });
    setCurrent(project);
    return { project, ladder };
  }

  it('shows what is in store, issues 3 of 10, and refuses 8 of the 7 that are left under the box', async () => {
    const { ladder } = setup();
    setRouteParams({ toolId: ladder, kind: 'issue' });
    await renderScreen(<ToolMove />);
    expect(visibleText()).toContain(E('inStoreCount', { n: '10' }));
    await typeInto(E('otherPersonName'), 'Nimal');
    await typeInto(E('howMany'), '3');
    await pressLabel(E('save'));
    expect(movements()).toEqual([{ kind: 'issue', qty_milli: 3000 }]);
    await screen.unmount();

    setRouteParams({ toolId: ladder, kind: 'issue' });
    await renderScreen(<ToolMove />);
    expect(visibleText()).toContain(E('inStoreCount', { n: '7' }));
    await typeInto(E('otherPersonName'), 'Sunil');
    await typeInto(E('howMany'), '8');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errStockShort'));
    expect(movements()).toHaveLength(1);
  });

  it('an empty count is an error under the box, never one piece', async () => {
    const { ladder } = setup();
    setRouteParams({ toolId: ladder, kind: 'issue' });
    await renderScreen(<ToolMove />);
    await typeInto(E('otherPersonName'), 'Nimal');
    await typeInto(E('howMany'), '');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errQty'));
    expect(movements()).toEqual([]);
  });

  it('a return starts with the pieces the holder has; more than is out is refused', async () => {
    const { ladder, project } = setup();
    const nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 300_000 });
    moveTool({ tool_id: ladder, kind: 'issue', project_id: project, worker_id: nimal, day: '2026-10-20', qty_milli: 3000 });
    setRouteParams({ toolId: ladder, kind: 'return' });
    await renderScreen(<ToolMove />);
    expect(inputValue(E('howMany'))).toBe('3');
    expect(visibleText()).toContain(E('outCount', { n: '3' }));
    await typeInto(E('howMany'), '5');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errReturnTooMany'));
    await typeInto(E('howMany'), '2');
    await pressLabel(E('save'));
    expect(movements()).toEqual([
      { kind: 'issue', qty_milli: 3000 },
      { kind: 'return', qty_milli: 2000 },
    ]);
  });

  it('a single piece has no box at all, and reads as it always did', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    const drill = saveTool({ name: 'Drill' });
    setCurrent(project);
    setRouteParams({ toolId: drill, kind: 'issue' });
    await renderScreen(<ToolMove />);
    expect(hasLabel(E('howMany'))).toBe(false);
  });
});

describe('the Tools tab: a material with nothing in store', () => {
  it('still has its row (Out of stock), so its page can be opened to add stock', async () => {
    saveTool({ name: 'Sand', is_material: true, quantity_milli: 0, unit: 'tons' });
    saveTool({ name: 'Drill' });
    await renderScreen(<ToolsScreen />);
    const text = visibleText();
    expect(text).toContain('Sand');
    expect(text).toContain(E('outOfStock'));
    expect(text).toContain('Drill');
  });
});
