import type { MetadataRoute } from 'next';

/**
 * Home-screen install metadata.
 *
 * `standalone` is the point of the file: launched from the home screen the app
 * gets no browser chrome, so the tab bar and header this repo renders are the
 * only navigation — which is why they have to carry every affordance the
 * address bar used to (league switching included).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Football Cheatsheet',
    short_name: 'Cheatsheet',
    description:
      'Market-aware lineup and roster management for Sleeper dynasty and redraft leagues.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08090b',
    theme_color: '#08090b',
    categories: ['sports', 'utilities'],
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
