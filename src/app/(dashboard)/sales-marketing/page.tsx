import { Suspense } from 'react';
import DemandSheetsPage from '../demand-sheets/page';

export default function SalesMarketingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Sales & Marketing...</div>}>
      <DemandSheetsPage />
    </Suspense>
  );
}
