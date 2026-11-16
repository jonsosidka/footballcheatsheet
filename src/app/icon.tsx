import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * The home-screen mark: one slash from the "///" release strip, lime on the
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
          background: '#0b0b0c',
          color: '#c8ff00',
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
