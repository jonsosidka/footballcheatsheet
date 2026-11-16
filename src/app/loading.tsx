import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      eyebrow="Dashboard"
      title={
        <>
          Football <em className="text-signal not-italic">Cheatsheet</em>
        </>
      }
      active="/"
    />
  );
}
