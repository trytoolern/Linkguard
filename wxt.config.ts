import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: 'LinkGuard', description: '__MSG_extensionDescription__',
    default_locale: 'en',
    incognito: 'not_allowed',
    permissions: ['activeTab', 'scripting', 'storage', 'webRequest'],
    host_permissions: ['http://*/*', 'https://*/*'],
    ...(browser === 'firefox' ? {
      optional_permissions: ['cookies'],
      browser_specific_settings: {
        gecko: {
          id: '{9fbd8267-c8ae-4ae1-9c86-f08d57ed2b81}',
          strict_min_version: '140.0',
          // Page links are sent to their destinations on an explicit scan.
          data_collection_permissions: { required: ['websiteContent'] },
        },
      },
    } : { minimum_chrome_version: '120' }),
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: '__MSG_actionTitle__' },
  }),
});
