import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * The home-screen mark: the electric-lime slash the wordmark uses, on the
 * app's own near-black. Drawn in code so it stays in step with the palette
 * instead of drifting as a checked-in binary.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#08090b',
          color: '#c9f24d',
          fontSize: 300,
          fontWeight: 700,
          letterSpacing: '-0.06em',
        }}
      >
        /
      </div>
    ),
    { ...size },
  );
}
