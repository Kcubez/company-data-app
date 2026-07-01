import { Suspense } from 'react';
import BusinessReportsPage from '../business-reports/page';

export default function FinancePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Finance...</div>}>
      <BusinessReportsPage />
    </Suspense>
  );
}
