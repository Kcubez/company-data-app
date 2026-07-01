import { Suspense } from 'react';
import CustomersPage from '../customers/page';

export default function CustomerServicePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Customer Service...</div>}>
      <CustomersPage />
    </Suspense>
  );
}
