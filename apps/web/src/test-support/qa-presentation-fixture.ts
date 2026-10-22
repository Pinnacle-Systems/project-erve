import { makeQualityExecutionView } from '../pages/qa/pdf/execution/qualityExecutionTestFixture.js';
// These are presentation fixtures, including old keys and renamed display labels.
export function contextExecution(
  activityName = 'Inline Inspection',
  status: 'DRAFT' | 'FINALIZED' = 'FINALIZED',
) {
  const execution = makeQualityExecutionView({ activityName, status });
  execution.sections = [
    {
      id: 'context',
      title: 'Inspection context',
      sequence: 1,
      components: [
        {
          id: 'derived',
          title: 'System context',
          sequence: 1,
          type: 'SYSTEM_CONTEXT',
          config: {
            fields: [
              { key: 'factory', source: 'SYSTEM', sourceKey: 'FACTORY_NAME', label: 'Factory' },
              { key: 'quantity', source: 'SYSTEM', sourceKey: 'ORDER_QUANTITY', label: 'Quantity' },
              {
                key: 'customer',
                source: 'SYSTEM',
                sourceKey: 'CUSTOMER_NAME',
                label: 'Renamed customer label',
              },
              {
                key: 'purchaseOrder',
                source: 'SYSTEM',
                sourceKey: 'PURCHASE_ORDER_NUMBER',
                label: 'Reference',
              },
              {
                key: 'merchandiser',
                source: 'SYSTEM',
                sourceKey: 'MERCHANDISER_NAME',
                label: 'Planner',
              },
              { key: 'eiosNumber', label: 'Historical reference' },
            ],
          },
          systemValue: [
            { key: 'factory', value: 'Approved Factory', available: true },
            { key: 'quantity', value: 1800, available: true },
            { key: 'customer', value: 'Distributor Alpha, Distributor Beta', available: true },
            { key: 'purchaseOrder', value: 'EIOS-ALPHA, EIOS-BETA', available: true },
            { key: 'merchandiser', value: 'Private Planner', available: true },
            { key: 'eiosNumber', value: 'EIOS-HISTORICAL', available: true },
          ],
        },
        {
          id: 'authored',
          title: 'Report details',
          sequence: 2,
          type: 'FIELD_GROUP',
          config: {
            fields: [
              { key: 'customer', label: 'Customer', source: 'USER', dataType: 'TEXT' },
              { key: 'supplier', label: 'Supplier', source: 'USER', dataType: 'TEXT' },
              { key: 'meetingDate', label: 'Meeting date', source: 'USER', dataType: 'DATE' },
              {
                key: 'systemPo',
                label: 'Renamed system field',
                source: 'SYSTEM',
                sourceKey: 'PURCHASE_ORDER_NUMBER',
              },
            ],
          },
          systemValue: [{ key: 'systemPo', value: 'EIOS-MIXED-FIELD', available: true }],
        },
      ],
    },
  ];
  execution.responses.fieldResponses = [
    { componentId: 'authored', fieldKey: 'customer', value: 'Authored Buyer' },
    { componentId: 'authored', fieldKey: 'supplier', value: 'Authored Supplier' },
    { componentId: 'authored', fieldKey: 'meetingDate', value: '2026-01-15' },
  ];
  return execution;
}
