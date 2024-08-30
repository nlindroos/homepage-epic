import { useForm } from '@conform-to/react'
import { parse } from '@conform-to/zod'
import { cssBundleHref } from '@remix-run/css-bundle'
import {
  json,
  type HeadersFunction,
  type LinksFunction,
  type MetaFunction,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from '@remix-run/node'
import {
  Form,
  Link,
  Links,
  LiveReload,
  Meta,
  // NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useFetcher,
  useFetchers,
  useLoaderData,
  useLocation,
  useMatches,
  useSubmit,
} from '@remix-run/react'
import { withSentry } from '@sentry/remix'
import clsx from 'clsx'
import { useRef } from 'react'
import { AuthenticityTokenProvider } from 'remix-utils/csrf/react'
import { HoneypotProvider } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { css } from '#styled-system/css'
import { GeneralErrorBoundary } from './components/error-boundary.tsx'
import { ErrorList } from './components/forms.tsx'
import { EpicProgress } from './components/progress-bar.tsx'
import { SearchBar } from './components/search-bar.tsx'
import { EpicToaster } from './components/toaster.tsx'
import { Button } from './components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.tsx'
import { Icon, href as iconsHref } from './components/ui/icon.tsx'
import styles from './index.css'
import fontStyleSheetUrl from './styles/font.css'
import tailwindStyleSheetUrl from './styles/tailwind.css'
import { getUserId, logout } from './utils/auth.server.ts'
import { ClientHintCheck, getHints, useHints } from './utils/client-hints.tsx'
import { csrf } from './utils/csrf.server.ts'
import { prisma } from './utils/db.server.ts'
import { getEnv } from './utils/env.server.ts'
import { honeypot } from './utils/honeypot.server.ts'
import { combineHeaders, getDomainUrl, getUserImgSrc } from './utils/misc.tsx'
import { useNonce } from './utils/nonce-provider.ts'
import { useRequestInfo } from './utils/request-info.ts'
import { type Theme, setTheme, getTheme } from './utils/theme.server.ts'
import { makeTimings, time } from './utils/timing.server.ts'
import { getToast } from './utils/toast.server.ts'
import { useOptionalUser, useUser } from './utils/user.ts'

export const links: LinksFunction = () => {
  return [
    // Preload svg sprite as a resource to avoid render blocking
    { rel: 'preload', href: iconsHref, as: 'image' },
    // Preload CSS as a resource to avoid render blocking
    { rel: 'preload', href: fontStyleSheetUrl, as: 'style' },
    { rel: 'preload', href: tailwindStyleSheetUrl, as: 'style' },
    { rel: 'preload', href: styles, as: 'style' },
    cssBundleHref ? { rel: 'preload', href: cssBundleHref, as: 'style' } : null,
    { rel: 'mask-icon', href: '/favicons/mask-icon.svg' },
    {
      rel: 'alternate icon',
      type: 'image/png',
      href: '/favicons/favicon-32x32.png',
    },
    { rel: 'apple-touch-icon', href: '/favicons/apple-touch-icon.png' },
    {
      rel: 'manifest',
      href: '/site.webmanifest',
      crossOrigin: 'use-credentials',
    } as const, // necessary to make typescript happy
    //These should match the css preloads above to avoid css as render blocking resource
    { rel: 'icon', type: 'image/svg+xml', href: '/favicons/favicon.svg' },
    { rel: 'stylesheet', href: fontStyleSheetUrl },
    { rel: 'stylesheet', href: tailwindStyleSheetUrl },
    { rel: 'stylesheet', href: styles },
    cssBundleHref ? { rel: 'stylesheet', href: cssBundleHref } : null,
  ].filter(Boolean)
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    { title: data ? 'Epic Notes' : 'Error | Epic Notes' },
    { name: 'description', content: `Your own captain's log` },
  ]
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const timings = makeTimings('root loader')
  const userId = await time(() => getUserId(request), {
    timings,
    type: 'getUserId',
    desc: 'getUserId in root',
  })

  const user = userId
    ? await time(
        () =>
          prisma.user.findUniqueOrThrow({
            select: {
              id: true,
              name: true,
              username: true,
              image: { select: { id: true } },
              roles: {
                select: {
                  name: true,
                  permissions: {
                    select: { entity: true, action: true, access: true },
                  },
                },
              },
            },
            where: { id: userId },
          }),
        { timings, type: 'find user', desc: 'find user in root' },
      )
    : null
  if (userId && !user) {
    console.info('something weird happened')
    // something weird happened... The user is authenticated but we can't find
    // them in the database. Maybe they were deleted? Let's log them out.
    await logout({ request, redirectTo: '/' })
  }
  const { toast, headers: toastHeaders } = await getToast(request)
  const honeyProps = honeypot.getInputProps()
  const [csrfToken, csrfCookieHeader] = await csrf.commitToken()

  return json(
    {
      user,
      requestInfo: {
        hints: getHints(request),
        origin: getDomainUrl(request),
        path: new URL(request.url).pathname,
        userPrefs: {
          theme: getTheme(request),
        },
      },
      ENV: getEnv(),
      toast,
      honeyProps,
      csrfToken,
    },
    {
      headers: combineHeaders(
        { 'Server-Timing': timings.toString() },
        toastHeaders,
        csrfCookieHeader ? { 'set-cookie': csrfCookieHeader } : null,
      ),
    },
  )
}

const NavLink = ({
  to,
  ...rest
}: Omit<Parameters<typeof Link>['0'], 'to'> & { to: string }) => {
  const location = useLocation()
  const isSelected =
    to === location.pathname || location.pathname.startsWith(`${to}/`)

  return (
    <li className="px-5 py-2">
      <Link
        prefetch="intent"
        className={clsx(
          'underlined hover:text-team-current focus:text-team-current block whitespace-nowrap text-lg font-medium focus:outline-none',
          {
            'active text-team-current': isSelected,
            'text-secondary': !isSelected,
          },
        )}
        to={to}
        {...rest}
      />
    </li>
  )
}

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = {
    'Server-Timing': loaderHeaders.get('Server-Timing') ?? '',
  }
  return headers
}

const ThemeFormSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
})

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData()
  const submission = parse(formData, {
    schema: ThemeFormSchema,
  })
  if (submission.intent !== 'submit') {
    return json({ status: 'idle', submission } as const)
  }
  if (!submission.value) {
    return json({ status: 'error', submission } as const, { status: 400 })
  }
  const { theme } = submission.value

  const responseInit = {
    headers: { 'set-cookie': setTheme(theme) },
  }
  return json({ success: true, submission }, responseInit)
}

function Document({
  children,
  nonce,
  theme = 'light',
  env = {},
}: {
  children: React.ReactNode
  nonce: string
  theme?: Theme
  env?: Record<string, string>
}) {
  return (
    <html lang="en" className={`${theme} h-full overflow-x-hidden`}>
      <head>
        <ClientHintCheck nonce={nonce} />
        <Meta />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Links />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(env)}`,
          }}
        />
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
        <LiveReload nonce={nonce} />
      </body>
    </html>
  )
}

const LINKS = [
  { name: 'Home', to: '/' },
  { name: 'Courses', to: '/courses' },
  { name: 'Discord', to: '/discord' },
  { name: 'Chats', to: '/chats/04' },
  { name: 'Calls', to: '/calls/04' },
  { name: 'Workshops', to: '/workshops' },
  { name: 'About', to: '/about' },
]

const App = () => {
  const data = useLoaderData<typeof loader>()
  const nonce = useNonce()
  const user = useOptionalUser()
  const theme = useTheme()
  const matches = useMatches()
  const isOnSearchPage = matches.find(m => m.id === 'routes/users+/index')
  const searchBar = isOnSearchPage ? null : <SearchBar status="idle" />

  return (
    <Document nonce={nonce} theme={theme} env={data.ENV}>
      <div className="flex h-screen flex-col justify-between">
        <header className="container p-6">
          <div className="px-5vw py-9 lg:py-12">
            <nav className="max-w-8xl mx-10 flex items-center justify-between text-primary">
              <div className="flex justify-center gap-4 align-middle">
                <Link
                  prefetch="intent"
                  to="/"
                  className="underlined block whitespace-nowrap text-2xl font-medium text-primary transition focus:outline-none"
                >
                  <h1>NL</h1>
                </Link>
              </div>
              {/* <div className={css({ fontSize: '2xl', fontWeight: 'bold' })}>
                Hello 🐼!
              </div> */}
              <ul className="hidden flex-row gap-4 lg:flex">
                {LINKS.map(link => (
                  <NavLink key={link.to} to={link.to}>
                    {link.name}
                  </NavLink>
                ))}
              </ul>

              <div className="flex items-center justify-center">
                <div className="block lg:hidden">
                  {/* <MobileMenu /> */}
                  <p>mobile menu</p>
                </div>
                <div className="noscript-hidden hidden lg:block">
                  {/* <DarkModeToggle /> */}
                  <p>darkmodetoggle</p>
                </div>
                {/* 
          <ProfileButton
            magicLinkVerified={requestInfo.session.magicLinkVerified}
            imageUrl={avatar.src}
            imageAlt={avatar.alt}
            team={team}
          /> */}
              </div>
            </nav>
          </div>
        </header>

        <div className="flex-1">
          <Outlet />
        </div>

        <div className="container flex justify-between pb-5">
          <Link to="/">
            <div className="font-light">epic</div>
            <div className="font-bold">notes</div>
          </Link>
          <ThemeSwitch userPreference={data.requestInfo.userPrefs.theme} />
        </div>
      </div>
      <EpicToaster toast={data.toast} />
      <EpicProgress />
    </Document>
  )
}

const AppWithProviders = () => {
  const data = useLoaderData<typeof loader>()
  return (
    <AuthenticityTokenProvider token={data.csrfToken}>
      <HoneypotProvider {...data.honeyProps}>
        <App />
      </HoneypotProvider>
    </AuthenticityTokenProvider>
  )
}

export default withSentry(AppWithProviders)

/**
 * @returns the user's theme preference, or the client hint theme if the user
 * has not set a preference.
 */
export const useTheme = () => {
  const hints = useHints()
  const requestInfo = useRequestInfo()
  const optimisticMode = useOptimisticThemeMode()
  if (optimisticMode) {
    return optimisticMode === 'system' ? hints.theme : optimisticMode
  }
  return requestInfo.userPrefs.theme ?? hints.theme
}

/**
 * If the user's changing their theme mode preference, this will return the
 * value it's being changed to.
 */
export const useOptimisticThemeMode = () => {
  const fetchers = useFetchers()
  const themeFetcher = fetchers.find(f => f.formAction === '/')

  if (themeFetcher && themeFetcher.formData) {
    const submission = parse(themeFetcher.formData, {
      schema: ThemeFormSchema,
    })
    return submission.value?.theme
  }
}

const ThemeSwitch = ({ userPreference }: { userPreference?: Theme | null }) => {
  const fetcher = useFetcher<typeof action>()

  const [form] = useForm({
    id: 'theme-switch',
    lastSubmission: fetcher.data?.submission,
  })

  const optimisticMode = useOptimisticThemeMode()
  const mode = optimisticMode ?? userPreference ?? 'system'
  const nextMode =
    mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system'
  const modeLabel = {
    light: (
      <Icon name="sun">
        <span className="sr-only">Light</span>
      </Icon>
    ),
    dark: (
      <Icon name="moon">
        <span className="sr-only">Dark</span>
      </Icon>
    ),
    system: (
      <Icon name="laptop">
        <span className="sr-only">System</span>
      </Icon>
    ),
  }

  return (
    <fetcher.Form method="POST" {...form.props}>
      <input type="hidden" name="theme" value={nextMode} />
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex h-8 w-8 cursor-pointer items-center justify-center"
        >
          {modeLabel[mode]}
        </button>
      </div>
      <ErrorList errors={form.errors} id={form.errorId} />
    </fetcher.Form>
  )
}

export const ErrorBoundary = () => {
  // the nonce doesn't rely on the loader so we can access that
  const nonce = useNonce()

  // NOTE: you cannot use useLoaderData in an ErrorBoundary because the loader
  // likely failed to run so we have to do the best we can.
  // We could probably do better than this (it's possible the loader did run).
  // This would require a change in Remix.

  // Just make sure your root route never errors out and you'll always be able
  // to give the user a better UX.

  return (
    <Document nonce={nonce}>
      <GeneralErrorBoundary />
    </Document>
  )
}
