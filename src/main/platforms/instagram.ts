import type { PlatformProvider } from './types'

export const instagram: PlatformProvider = {
  info: {
    id: 'instagram',
    name: 'Instagram',
    color: '#e1306c',
    liveAvailable: false,
    capabilities: {
      formats: {
        short_video: { minDurationSec: 3, maxDurationSec: 900, note: 'Published as a Reel.' },
        image: {},
        carousel: { minItems: 2, maxItems: 10 }
      },
      descriptionMax: 2200,
      maxHashtags: 30,
      supportsThumbnail: true,
      options: [
        {
          key: 'shareToFeed',
          label: 'Also show Reel in the main feed',
          type: 'toggle',
          default: true
        }
      ]
    },
    setupGuide: {
      title: 'Connect Instagram',
      steps: [
        'Switch your Instagram account to a Professional account (Business or Creator) in the Instagram app settings.',
        'Create a Facebook Page and link it to the Instagram account (Page settings → Linked accounts).',
        'Go to developers.facebook.com, create an app of type "Business", and add the Instagram product.',
        'Add your own Facebook profile as an admin or tester of the app so you can use it without app review.',
        'Copy the App ID and App Secret. You will paste them into this app when live Instagram support is added.'
      ],
      links: [
        { label: 'Meta for Developers', url: 'https://developers.facebook.com/' },
        {
          label: 'Instagram content publishing',
          url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing'
        }
      ],
      caveat: 'Only Business and Creator accounts can be published to through the API. Personal accounts cannot.'
    }
  }
}
