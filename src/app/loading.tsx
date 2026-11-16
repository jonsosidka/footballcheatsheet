import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      kicker="[ My Team ] — Loading"
      title={
        <>
          Reading
          <br />
          <span className="outline-text">your roster.</span>
        </>
      }
      active="/"
    />
  );
}
