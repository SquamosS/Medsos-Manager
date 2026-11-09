import type { PlatformProvider } from './types'

export const tiktok: PlatformProvider = {
  info: {
    id: 'tiktok',
    name: 'TikTok',
    color: '#25f4ee',
    liveAvailable: false,
    capabilities: {
      formats: {
        short_video: { minDurationSec: 3, maxDurationSec: 600, note: 'The maximum length depends on your account.' },
        image: {},
        carousel: { minItems: 2, maxItems: 35 }
      },
      descriptionMax: 2200,
      supportsThumbnail: false,
      options: [
        {
          key: 'privacy',
          label: 'Who can view',
          type: 'select',
          default: 'public',
          choices: [
            { value: 'public', label: 'Everyone' },
            { value: 'friends', label: 'Friends' },
            { value: 'private', label: 'Only me' }
          ]
        },
        { key: 'allowComments', label: 'Allow comments', type: 'toggle', default: true },
        { key: 'allowDuet', label: 'Allow Duet', type: 'toggle', default: false },
        { key: 'allowStitch', label: 'Allow Stitch', type: 'toggle', default: false }
      ]
    },
    setupGuide: {
      title: 'Connect TikTok',
      steps: [
        'Sign in at developers.tiktok.com with your TikTok account and register as a developer.',
        'Create an app, then add the "Login Kit" and "Content Posting API" products.',
        'Add a redirect URI for the desktop app (this app will show you the exact value when live TikTok support is added).',
        'Copy the Client Key and Client Secret.',
        'Add your own TikTok account as a target user while the app is in sandbox mode.'
      ],
      links: [
        { label: 'TikTok for Developers', url: 'https://developers.tiktok.com/' },
        { label: 'Content Posting API', url: 'https://developers.tiktok.com/doc/content-posting-api-get-started' }
      ],
      caveat:
        'Until TikTok audits your app, posts made through the API are restricted to private visibility. Uploading as a draft and publishing from the TikTok app is the usual workaround.'
    }
  }
}
