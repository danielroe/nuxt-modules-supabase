import { fileURLToPath } from 'url'
import { defu } from 'defu'
import { defineNuxtModule, addPlugin, addServerHandler, extendViteConfig, createResolver, resolveModule, addTemplate } from '@nuxt/kit'
import { CookieOptions, SupabaseClientOptions } from '@supabase/supabase-js'

export interface ModuleOptions {
  /**
   * Supabase API URL
   * @default process.env.SUPABASE_URL
   * @example 'https://*.supabase.co'
   * @type string
   * @docs https://supabase.com/docs/reference/javascript/initializing#parameters
   */
  url: string

  /**
   * Supabase API key
   * @default process.env.SUPABASE_KEY
   * @example '123456789'
   * @type string
   * @docs https://supabase.com/docs/reference/javascript/initializing#parameters
   */
  key: string

  /**
   * Supabase Client options
   * @default {}
   * @type object
   * @docs https://supabase.com/docs/reference/javascript/initializing#parameters
   */
  client?: SupabaseClientOptions

  /**
   * Supabase Client options
   * @default {
      name: 'sb',
      lifetime: 60 * 60 * 8,
      domain: '',
      path: '/',
      sameSite: 'lax'
    }
   * @type object
   * @docs https://supabase.com/docs/reference/javascript/initializing#parameters
   */
  cookies?: CookieOptions
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nuxtjs/supabase',
    configKey: 'supabase',
    compatibility: {
      nuxt: '^3.0.0'
    }
  },
  defaults: {
    url: process.env.SUPABASE_URL as string,
    key: process.env.SUPABASE_KEY as string,
    client: {},
    cookies: {
      name: 'sb',
      lifetime: 60 * 60 * 8,
      domain: '',
      path: '/',
      sameSite: 'lax'
    }
  },
  setup (options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const resolveRuntimeModule = (path: string) => resolveModule(path, { paths: resolve('./runtime') })

    // Make sure url and key are set
    if (!options.url) {
      // eslint-disable-next-line no-console
      console.warn('Missing `SUPABASE_URL` in `.env`')
    }
    if (!options.key) {
      // eslint-disable-next-line no-console
      console.warn('Missing `SUPABASE_KEY` in `.env`')
    }

    // Default runtimeConfig
    nuxt.options.runtimeConfig.public.supabase = defu(nuxt.options.runtimeConfig.public.supabase, {
      url: options.url,
      key: options.key,
      client: options.client,
      cookies: options.cookies
    })

    // Transpile runtime
    const runtimeDir = fileURLToPath(new URL('./runtime', import.meta.url))
    nuxt.options.build.transpile.push(runtimeDir)

    // Add supabase server plugin to load the user on server-side
    addPlugin(resolve(runtimeDir, 'plugins', 'supabase.server'))
    addPlugin(resolve(runtimeDir, 'plugins', 'supabase.client'))

    // Add supabase session endpoint to store the session on server-side
    addServerHandler({
      route: '/api/_supabase/session',
      handler: resolve(runtimeDir, 'server/api/session')
    })

    // Add supabase composables
    nuxt.hook('autoImports:dirs', (dirs) => {
      dirs.push(resolve(runtimeDir, 'composables'))
    })

    nuxt.hook('nitro:config', (nitroConfig) => {
      // Inline module runtime in Nitro bundle
      nitroConfig.externals = defu(typeof nitroConfig.externals === 'object' ? nitroConfig.externals : {}, {
        inline: [resolve('./runtime')]
      })
      nitroConfig.alias['#supabase/server'] = resolveRuntimeModule('./server/services')
    })

    addTemplate({
      filename: 'types/supabase.d.ts',
      getContents: () => [
        'declare module \'#supabase/server\' {',
        `  const serverSupabaseClient: typeof import('${resolve('./runtime/server/services')}').serverSupabaseClient`,
        `  const serverSupabaseUser: typeof import('${resolve('./runtime/server/services')}').serverSupabaseUser`,
        '}'
      ].join('\n')
    })

    nuxt.hook('prepare:types', (options) => {
      options.references.push({ path: resolve(nuxt.options.buildDir, 'types/supabase.d.ts') })
    })

    // Optimize cross-fetch
    extendViteConfig((config) => {
      config.optimizeDeps = config.optimizeDeps || {}
      config.optimizeDeps.include = config.optimizeDeps.include || []
      config.optimizeDeps.include.push('cross-fetch')
    })

    // Optimize websocket only at dev time
    if (nuxt.options.dev) {
      extendViteConfig((config) => {
        config.optimizeDeps.include.push('websocket')
      })
    }
  }
})
