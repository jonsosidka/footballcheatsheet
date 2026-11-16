import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      kicker="[ Draft ] — Loading"
      title={
        <>
          Draft
          <br />
          <span className="outline-text">room.</span>
        </>
      }
      active="/draft"
    />
  );
}
