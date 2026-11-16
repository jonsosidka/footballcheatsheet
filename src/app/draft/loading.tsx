import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      eyebrow="Draft room"
      title={
        <>
          Draft <em className="text-signal not-italic">/</em> Board
        </>
      }
      active="/draft"
    />
  );
}
