import { Suspense } from 'react';
import ProjectExpiriesPage from '../project-expiries/page';

export default function ProjectsInfraPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Projects & Infra...</div>}>
      <ProjectExpiriesPage />
    </Suspense>
  );
}
