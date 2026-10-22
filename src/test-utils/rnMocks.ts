/**
 * Mocks for the React Native / Expo UI modules the screens import, so a screen can be rendered
 * under Jest with no device. Import it for its side effect, FIRST, in a screen test:
 *
 *   import '@/test-utils/rnMocks';
 *
 * (Babel hoists the jest.mock() calls below only inside this file; importing it before the
 * screens is what makes them take effect, because modules are required in import order.)
 *
 *   expo-router                  router.push/replace/back are jest.fn; useLocalSearchParams reads
 *                                setRouteParams(); Stack.Screen RENDERS its title and headerRight
 *                                (so header buttons such as the trash can can be pressed);
 *                                Tabs / ThemeProvider are pass-through
 *   lucide-react-native          every icon is a plain <Icon name size color /> host element
 *   expo-image                   <ExpoImage /> host element
 *   react-native-reanimated      a small stub: animated views are plain views, animations jump to the end
 *   react-native-safe-area-context   the library's own jest mock (insets 0)
 *   @react-native-community/datetimepicker   <DateTimePicker /> host element carrying its props
 *   expo-font / expo-splash-screen / expo-status-bar / expo-system-ui   no-ops
 *   react-native-gesture-handler GestureHandlerRootView is a View
 *
 * The data-layer mocks (sqlite, file system, camera, print, sharing ...) come from setup.ts.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------- route state

interface RouteState {
  params: Record<string, string | undefined>;
  pathname: string;
}

function routeState(): RouteState {
  const g = globalThis as unknown as { __bmRoute?: RouteState };
  return (g.__bmRoute ??= { params: {}, pathname: '/' });
}

/** What useLocalSearchParams() returns for the next render, e.g. setRouteParams({ id: 'abc' }). */
export function setRouteParams(params: Record<string, string | undefined> = {}): void {
  routeState().params = params;
}

/** What usePathname() returns, e.g. '/projects'. */
export function setPathname(pathname: string): void {
  routeState().pathname = pathname;
}

/**
 * The window the screens are laid out in. React Native's jest default is 750 wide (a tablet), but the app is
 * used on phones: tests start at 360 (see PHONE_WIDTH in screenKit) and some variants use 320 (stacked stat
 * tiles, icon-only floating button) and 768 (centred content, 24 dp gutter). Set it BEFORE mounting.
 */
export function setWindow(width: number, height = 800): void {
  const { Dimensions } = require('react-native') as typeof import('react-native');
  const size = { width, height, scale: 3, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
}

export function resetRoute(): void {
  routeState().params = {};
  routeState().pathname = '/';
}

// ---------------------------------------------------------------- expo-router

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  const { View, Text } = require('react-native') as typeof import('react-native');
  const state = () => (globalThis as unknown as { __bmRoute: { params: Record<string, string | undefined>; pathname: string } }).__bmRoute;
  const params = () => state()?.params ?? {};

  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    setParams: jest.fn(),
    canGoBack: jest.fn(() => true),
  };

  /** The real Stack.Screen only sets header options; here the header is drawn so tests can see and press it. */
  function StackScreen({ name, options }: { name?: string; options?: { title?: string; headerRight?: () => React.ReactNode } }) {
    if (!options) return null;
    // A layout declares its routes by name (title only): those just show the title. A screen sets its own header.
    if (name) return options.title != null ? React.createElement(Text, { testID: 'stack-route' }, options.title) : null;
    return React.createElement(
      View,
      { testID: 'stack-header' },
      options.title != null ? React.createElement(Text, { accessibilityRole: 'header' }, options.title) : null,
      options.headerRight ? options.headerRight() : null,
    );
  }
  const passThrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const Stack = Object.assign(passThrough, { Screen: StackScreen });
  const Tabs = Object.assign(() => null, { Screen: () => null });

  const colors = { primary: '#000', background: '#fff', card: '#fff', text: '#000', border: '#ccc', notification: '#f00' };
  return {
    __esModule: true,
    router,
    useRouter: () => router,
    useLocalSearchParams: () => params(),
    useGlobalSearchParams: () => params(),
    usePathname: () => state()?.pathname ?? '/',
    useSegments: () => [],
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), [cb]);
    },
    Stack,
    Tabs,
    Slot: passThrough,
    Link: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Redirect: () => null,
    ThemeProvider: passThrough,
    DefaultTheme: { dark: false, colors },
    DarkTheme: { dark: true, colors },
  };
});

// ---------------------------------------------------------------- icons & images

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const cache = new Map<string, unknown>();
  const target: Record<string, unknown> = { __esModule: true };
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in t) return t[prop];
      let icon = cache.get(prop);
      if (!icon) {
        const Icon = (props: Record<string, unknown>) => React.createElement('Icon', { name: prop, ...props });
        Icon.displayName = prop;
        icon = Icon;
        cache.set(prop, icon);
      }
      return icon;
    },
  });
});

jest.mock('expo-image', () => {
  const React = require('react') as typeof import('react');
  return { __esModule: true, Image: (props: Record<string, unknown>) => React.createElement('ExpoImage', props) };
});

// ---------------------------------------------------------------- animation, layout, pickers

/**
 * The library's own jest mock cannot load here: Reanimated 4 needs the worklets native module (or a
 * custom jest resolver for the whole project). The app only uses a few APIs, so they are stubbed:
 * animated views are plain views, shared values hold a plain number, animations jump to the end value.
 */
jest.mock('react-native-reanimated', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const AnimatedView = React.forwardRef(function AnimatedView(props: Record<string, unknown>, ref: unknown) {
    const { entering: _entering, exiting: _exiting, layout: _layout, ...rest } = props;
    return React.createElement(View, { ...rest, ref } as never);
  });
  const entry: Record<string, unknown> = {};
  for (const m of ['duration', 'delay', 'springify', 'easing', 'damping', 'stiffness', 'withCallback']) entry[m] = () => entry;
  return {
    __esModule: true,
    default: { View: AnimatedView, createAnimatedComponent: (c: unknown) => c },
    FadeIn: entry,
    FadeInDown: entry,
    FadeOutDown: entry,
    SlideInDown: entry,
    Easing: { bezier: () => (t: number) => t, linear: (t: number) => t, out: (f: unknown) => f, in: (f: unknown) => f },
    useSharedValue: <T,>(init: T) => {
      const ref = React.useRef<{ value: T; get: () => T; set: (v: T) => void } | null>(null);
      if (!ref.current) {
        const sv = { value: init, get: () => sv.value, set: (v: T) => { sv.value = v; } };
        ref.current = sv;
      }
      return ref.current;
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: <T,>(v: T) => v,
    withSpring: <T,>(v: T) => v,
  };
});

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react') as typeof import('react');
  return { __esModule: true, default: (props: Record<string, unknown>) => React.createElement('DateTimePicker', props) };
});

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native') as typeof import('react-native');
  return { __esModule: true, GestureHandlerRootView: View };
});

// ---------------------------------------------------------------- app shell (root layout)

jest.mock('expo-font', () => ({ __esModule: true, useFonts: jest.fn(() => [true, null]), isLoaded: jest.fn(() => true), loadAsync: jest.fn(async () => undefined) }));

jest.mock('expo-splash-screen', () => ({
  __esModule: true,
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

jest.mock('expo-status-bar', () => ({ __esModule: true, StatusBar: () => null }));

jest.mock('expo-system-ui', () => ({ __esModule: true, setBackgroundColorAsync: jest.fn(async () => undefined) }));
