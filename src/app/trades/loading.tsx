import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      eyebrow="Trade finder"
      title={
        <>
          Trade <em className="text-signal not-italic">Targets</em>
        </>
      }
      active="/trades"
    />
  );
}
