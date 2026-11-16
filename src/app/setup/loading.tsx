import { PageSkeleton, PanelSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      kicker="[ Setup ] — Sleeper import"
      title={
        <>
          Bring
          <br />
          <span className="outline-text">your league.</span>
        </>
      }
      active="/setup"
    >
      <PanelSkeleton rows={4} className="max-w-[900px]" />
    </PageSkeleton>
  );
}
