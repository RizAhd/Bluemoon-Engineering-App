/**
 * The smoke tests are only worth something if they fail when a screen is broken. These tests feed the
 * checks in '@/test-utils/screenKit' deliberately broken components and expect each defect to be caught.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Text, TextInput, View } from 'react-native';

import { resetDb } from '@/test-utils';
import { expectClean, renderScreen, setRouteParams, takeConsole, visibleText } from '@/test-utils/screenKit';
import { setSetting } from '@/db';

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
});

const mount = (ui: React.ReactElement) => renderScreen(ui);

describe('expectClean catches what must never reach a phone', () => {
  it('passes a healthy screen', async () => {
    await mount(
      <View style={{ width: 10, backgroundColor: '#fff' }}>
        <Text>Rs 1,250</Text>
        <Check size={20} color="#000" />
      </View>,
    );
    expect(() => expectClean('healthy')).not.toThrow();
  });

  it.each([
    ['undefined', <Text key="a">{`Total ${undefined}`}</Text>],
    ['NaN', <Text key="a">{`Rs ${Number('x')}`}</Text>],
    ['[object Object]', <Text key="a">{`${{}}`}</Text>],
    ['null', <Text key="a">{`Name: ${null}`}</Text>],
    ['Infinity', <Text key="a">{`${1 / 0} days`}</Text>],
  ])('text containing %s', async (word, node) => {
    await mount(<View>{node}</View>);
    expect(() => expectClean('broken')).toThrow(word);
  });

  it('an accessibility label containing undefined', async () => {
    await mount(<View accessibilityLabel={`Open ${undefined}`} />);
    expect(() => expectClean('broken')).toThrow(/accessibility label/);
  });

  it('an input value containing NaN', async () => {
    await mount(<TextInput value="NaN" onChangeText={() => undefined} />);
    expect(() => expectClean('broken')).toThrow(/NaN/);
  });

  it('a NaN size, an undefined colour, and an icon without a colour', async () => {
    await mount(<View style={{ width: NaN }} />);
    expect(() => expectClean('broken')).toThrow(/style\.width/);
  });

  it('a style colour that is undefined', async () => {
    await mount(<View style={{ backgroundColor: undefined }} />);
    expect(() => expectClean('broken')).toThrow(/backgroundColor/);
  });

  it('an icon whose colour token does not exist', async () => {
    await mount(<Check size={20} color={undefined} />);
    expect(() => expectClean('broken')).toThrow(/Icon Check has color/);
  });
});

describe('rendering failures are not swallowed', () => {
  it('a screen that throws makes renderScreen reject', async () => {
    const Boom = () => {
      throw new Error('boom in render');
    };
    await expect(mount(<Boom />)).rejects.toThrow('boom in render');
    takeConsole(); // React reports the error on the console too
  });

  it('text outside a <Text> is refused', async () => {
    await expect(mount(<View>{'bare text'}</View>)).rejects.toThrow(/Text/);
    takeConsole();
  });

  it('a React warning is captured and would fail the test', async () => {
    await mount(
      <View>
        {[1, 2].map((n) => (
          // eslint-disable-next-line react/jsx-key -- the missing key is the point of this test
          <Text>{n}</Text>
        ))}
      </View>,
    );
    const logged = takeConsole(); // drained here on purpose; left in place it fails the test in afterEach
    expect(logged.join('\n')).toMatch(/key/);
  });

  it('route params reach the screen through useLocalSearchParams', async () => {
    const Show = () => {
      const p = useLocalSearchParams<{ id?: string }>();
      return <Text>{`id=${p.id}`}</Text>;
    };
    setRouteParams({ id: 'abc' });
    await mount(<Show />);
    expect(visibleText()).toBe('id=abc');
  });
});
