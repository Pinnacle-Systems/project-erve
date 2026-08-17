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
    plannedQuantity: 10,
    completedQuantity: 10,
    remainingQuantity: 0,
    progressPercent: 100,
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
    plannedQuantity: 10,
    completedQuantity: 4,
    remainingQuantity: 6,
    progressPercent: 40,
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
    plannedQuantity: 10,
    completedQuantity: 0,
    remainingQuantity: 10,
    progressPercent: 0,
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

  it('renders authoritative quantity progress for Production activities', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });
    expect(container.textContent).toContain('4 / 10 completed · 40%');
  });

  it('renders migrated unknown progress without presenting it as zero', () => {
    const historical = {
      ...mockStages[0]!,
      completedQuantity: null,
      remainingQuantity: null,
      progressPercent: null,
    };
    act(() => {
      root.render(
        <ProductionStageStepper stages={[historical]} isPreparedQuantitiesUnlocked={false} />,
      );
    });
    expect(container.textContent).toContain('Historical progress not captured');
    expect(container.textContent).not.toContain('0 / 10');
  });

  it('renders all stages in an ordered list', () => {
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
    expect(list).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(4); // 3 stages + 1 final prepared quantities step
  });

  it('identifies the current step semantically', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    // Find the item with aria-current="step"
    const currentStep = container.querySelector('li[aria-current="step"]');
    expect(currentStep).not.toBeNull();
    expect(currentStep?.textContent).toContain('Printing');
  });

  it('renders completed stage metadata when available', () => {
    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={false}
        />,
      );
    });

    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('Cutting');
    expect(container.textContent).toContain('by Alice');
  });

  it('handles missing stage metadata gracefully', () => {
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

    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('Cutting');
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

    expect(container.textContent).toContain('Prepared Quantities');
    expect(container.textContent).toContain('Locked');

    act(() => {
      root.render(
        <ProductionStageStepper
          stages={mockStages}
          currentStageId="stage-2"
          isPreparedQuantitiesUnlocked={true}
        />,
      );
    });

    expect(container.textContent).toContain('Unlocked');
  });

  it('applies responsive classes for structure (horizontal/vertical) instead of flex-wrap', () => {
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
