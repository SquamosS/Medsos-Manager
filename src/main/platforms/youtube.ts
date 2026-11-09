import type { PlatformProvider } from './types'

export const youtube: PlatformProvider = {
  info: {
    id: 'youtube',
    name: 'YouTube',
    color: '#ff2d2d',
    liveAvailable: false,
    capabilities: {
      formats: {
        short_video: { maxDurationSec: 180, note: 'Shorts: vertical or square, up to 3 minutes.' },
        long_video: { note: 'Standard uploads. Unverified channels are limited to 15 minutes.' }
      },
      titleMax: 100,
      titleRequired: true,
      descriptionMax: 5000,
      maxHashtags: 15,
      supportsThumbnail: true,
      options: [
        {
          key: 'privacy',
          label: 'Visibility',
          type: 'select',
          default: 'public',
          choices: [
            { value: 'public', label: 'Public' },
            { value: 'unlisted', label: 'Unlisted' },
            { value: 'private', label: 'Private' }
          ]
        },
        {
          key: 'madeForKids',
          label: 'Made for kids',
          type: 'toggle',
          default: false,
          help: 'YouTube requires this declaration for every upload.'
        }
      ]
    },
    setupGuide: {
      title: 'Connect YouTube',
      steps: [
        'Open the Google Cloud Console and create a new project (any name).',
        'In "APIs & Services → Library", enable "YouTube Data API v3" and "YouTube Analytics API".',
        'Under "OAuth consent screen", choose External, fill in the app name and your email, and add your own Google account as a test user.',
        'Under "Credentials", create an OAuth client ID of type "Desktop app".',
        'Copy the Client ID and Client Secret. You will paste them into this app when live YouTube support is added.'
      ],
      links: [
        { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/' },
        { label: 'YouTube Data API overview', url: 'https://developers.google.com/youtube/v3/getting-started' }
      ],
      caveat:
        "API projects that have not passed Google's audit can have uploads locked to private. Apply for the audit once everything works."
    }
  }
}
