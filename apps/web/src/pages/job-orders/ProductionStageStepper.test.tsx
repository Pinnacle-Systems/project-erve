/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProductionStageStepper } from './ProductionStageStepper.js';
import type { JobOrderStage } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const mockStages: JobOrderStage[] = [
  {
    id: 'stage-1',
    processFlowVersionStageId: 'pf-stage-1',
    stageSequence: 1,
    stageNameSnapshot: 'Cutting',
    status: 'COMPLETED',
    completedAt: '2026-07-31T10:00:00Z',
    completedBy: { id: 'user-1', name: 'Alice', email: 'alice@test.local' },
    remarks: null,
    createdAt: '2026-07-30T10:00:00Z',
    updatedAt: '2026-07-31T10:00:00Z',
  },
  {
    id: 'stage-2',
    processFlowVersionStageId: 'pf-stage-2',
    stageSequence: 2,
    stageNameSnapshot: 'Printing',
    status: 'IN_PROGRESS',
    completedAt: null,
    completedBy: null,
    remarks: null,
    createdAt: '2026-07-30T10:00:00Z',
    updatedAt: '2026-07-31T10:00:00Z',
  },
  {
    id: 'stage-3',
    processFlowVersionStageId: 'pf-stage-3',
    stageSequence: 3,
    stageNameSnapshot: 'Sewing',
    status: 'NOT_STARTED',
    completedAt: null,
    completedBy: null,
    remarks: null,
    createdAt: '2026-07-30T10:00:00Z',
    updatedAt: '2026-07-31T10:00:00Z',
  },
];

describe('ProductionStageStepper', () => {
  it('renders nothing when there are no production stages', () => {
    act(() => {
      root.render(<ProductionStageStepper stages={[]} isPreparedQuantitiesUnlocked={true} />);
    });

    expect(container.innerHTML).toBe('');
  });

  it('does not render production quantities, percentages, or missing-progress messaging', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    expect(container.textContent).not.toContain('4 / 10 completed');
    expect(container.textContent).not.toContain('40%');
    expect(container.textContent).not.toContain('0%');
    expect(container.textContent).not.toContain('Historical progress not captured');
  });

  it('does not explain missing quantitative progress for historical stages', () => {
    const historical = {
      ...mockStages[0]!,
    };
    act(() => {
      root.render(
        <ProductionStageStepper stages={[historical]} isPreparedQuantitiesUnlocked={false} />,
      );
    });

    expect(container.textContent).not.toContain('Historical progress not captured');
    expect(container.textContent).not.toContain('0 / 10');
  });

  it('renders all stages in the original ordered-list structure', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(4);
  });

  it('preserves completed, current, and upcoming stage semantics', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    const items = container.querySelectorAll('li');
    expect(items[0]?.textContent).toContain('CuttingCompleted');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[1]?.textContent).toContain('PrintingCurrent');
    expect(items[2]?.textContent).toContain('SewingUpcoming');
  });

  it('retains genuine completed-stage timestamp and actor metadata', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    expect(container.textContent).toContain('31 Jul 2026');
    expect(container.textContent).toContain('by Alice');
  });

  it('handles missing completion metadata gracefully', () => {
    const stagesWithoutMeta = [
      { ...mockStages[0], completedAt: null, completedBy: null },
      ...mockStages.slice(1),
    ] as JobOrderStage[];
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={stagesWithoutMeta}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    expect(container.textContent).toContain('CuttingCompleted');
    expect(container.textContent).not.toContain('by Alice');
  });

  it('indicates the prepared quantities state', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    expect(container.textContent).toContain('Prepared QuantitiesLocked');

    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={true}
        />,
      );
    });

    expect(container.textContent).toContain('Prepared QuantitiesUnlocked');
  });

  it('preserves the original responsive horizontal/vertical structure', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    const list = container.querySelector('ol');
    expect(list?.className).toContain('flex-col');
    expect(list?.className).toContain('md:flex-row');
    expect(list?.className).not.toContain('flex-wrap');
  });
});
