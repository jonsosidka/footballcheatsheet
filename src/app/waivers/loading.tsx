import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      kicker="[ Waivers ] — Loading"
      title={
        <>
          Scanning
          <br />
          <span className="outline-text">the wire.</span>
        </>
      }
      active="/waivers"
    />
  );
}
