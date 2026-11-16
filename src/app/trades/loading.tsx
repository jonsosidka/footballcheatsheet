import { PageSkeleton } from '@/components/PageSkeleton';

export default function Loading() {
  return (
    <PageSkeleton
      kicker="[ Trades ] — Loading"
      title={
        <>
          Buy low.
          <br />
          <span className="outline-text">Sell high.</span>
        </>
      }
      active="/trades"
    />
  );
}
