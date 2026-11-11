import type { Column } from '../core/models';
import progress from '../sheet/fixtures/nursery-columns.json';
import { makeSheet } from '../test-helpers';
import { suggestedDashboard } from './dashboard-model';

describe('Nursery Progress: the Healthy % card', () => {
  it('has no goal of its own: it shows the average, not a target with a +/- against it', () => {
    const sheet = makeSheet(3, 'Nursery Progress', progress as Column[], [], 'nursery-batches');
    const card = suggestedDashboard(sheet).kpis.find((kpi) => kpi.title === 'Healthy %')!;
    expect(card.aggregate).toBe('average');
    expect(card.goal).toBeNull();
  });
});
