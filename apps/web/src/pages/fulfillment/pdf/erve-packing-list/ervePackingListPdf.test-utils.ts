import type { ErvePackingListDetail } from '../../types.js';

/** Deterministic, synthetic packed quantities, distinct per carton/style/size. */
export function packingListFixture(
  count: number,
  styles: number,
  sizes: number,
): ErvePackingListDetail {
  const cartons = Array.from({ length: count }, (_, c) => {
    const lines = Array.from({ length: styles }, (_, s) =>
      Array.from({ length: sizes }, (_, z) => ({
        saleOrderLineId: `line-${s}-${z}`,
        styleNumber: `ST-${String(s + 1).padStart(3, '0')}`,
        styleName: `Style ${s + 1}`,
        sizeCode: `SZ${z + 1}`,
        sizeLabel: `Size ${z + 1}`,
        quantity: (c + 1) * 1000 + s * sizes + z + 1,
      })),
    ).flat();
    return {
      id: `carton-${c}`,
      cartonNumber: `CTN-${String(c + 1).padStart(3, '0')}`,
      factory: { id: `f${c}`, code: `F${c}`, name: `Factory ${c + 1}` },
      factoryDispatchId: `fd${c}`,
      factoryDispatchNumber: `FD/${c + 1}`,
      saleOrder: { id: `so${c}`, saleOrderNumber: `EISO/${c + 1}` },
      packageDetails: 'Standard box',
      weight: '5kg',
      lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
  });
  return {
    id: 'synthetic-eipl',
    ervePackingListNumber: 'EIPL/26-27/TEST',
    distributor: { id: 'd', code: 'D', name: 'Synthetic Distributor' },
    saleOrder: null,
    destination: {
      label: 'Test Warehouse',
      contactName: 'Test Contact',
      contactEmail: 'test@example.com',
      contactPhone: '9999999999',
      addressLine1: '123 Test Street',
      addressLine2: null,
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      postalCode: '400001',
    },
    status: 'OPEN',
    createdBy: { id: 'u', name: 'Test User', email: 'test@example.com' },
    createdAt: '2026-10-21T00:00:00Z',
    cartonCount: count,
    totalQuantity: cartons.reduce((sum, carton) => sum + carton.totalQuantity, 0),
    sourceFactories: cartons.map((c) => c.factory),
    sourceDispatchOrders: cartons.map((c) => c.saleOrder),
    dispatch: null,
    finalizedBy: null,
    finalizedAt: null,
    cartons,
    styleSizeSummary: (cartons[0]?.lines ?? []).map((line, i) => ({
      ...line,
      quantity: cartons.reduce((sum, c) => sum + c.lines[i]!.quantity, 0),
    })),
  };
}
