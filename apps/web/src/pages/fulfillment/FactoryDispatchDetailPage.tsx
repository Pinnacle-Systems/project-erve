// Phase 4: this page's content moved to PackingListPage.tsx, which exports
// both the Dispatch-Order-keyed PackingListPage and this factory-dispatch-
// keyed FactoryDispatchDetailPage from one shared shell (they now render the
// same PackingListView projection). Re-exported here so any existing import
// path keeps working.
export { FactoryDispatchDetailPage } from './PackingListPage.js';
