import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { today } from '@/lib/dates';

/**
 * Today's date (yyyy-mm-dd, phone's own clock) that moves on by itself at midnight: a screen left open
 * overnight, or the app brought back the next morning, shows the new day without being touched.
 */
export function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => setDay((was) => (was === today() ? was : today()));
    const arm = () => {
      clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(() => {
        check();
        arm();
      }, midnight.getTime() - now.getTime());
    };
    arm();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      check();
      arm(); // timers do not run while the phone sleeps the app
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return day;
}
