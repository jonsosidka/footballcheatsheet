import { ImageResponse } from 'next/og';

// 180px is the size iOS actually rasterises for the home screen.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * iOS masks and shadows the home-screen icon itself, so this is drawn full
 * bleed with no rounding of its own — a rounded PNG would read as a second,
 * mismatched corner radius inside the system one.
 */
export default function AppleIcon() {
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
          fontSize: 110,
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
