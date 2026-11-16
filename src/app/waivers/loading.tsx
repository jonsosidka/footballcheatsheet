import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      eyebrow="Waiver board"
      title={
        <>
          Add <em className="text-signal not-italic">/</em> Drop
        </>
      }
      active="/waivers"
    />
  );
}
