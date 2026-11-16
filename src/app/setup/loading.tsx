import { PageSkeleton, PanelSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      eyebrow="Setup"
      title={
        <>
          Import <em className="text-signal not-italic">Leagues</em>
        </>
      }
      active="/setup"
      width="max-w-[900px]"
    >
      <PanelSkeleton rows={4} />
    </PageSkeleton>
  );
}
