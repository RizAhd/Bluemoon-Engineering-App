import { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

import { motion, useMotion } from '@/theme';

/** Strong ease-out: quick to react, soft to settle. Never ease-in on UI. */
const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Press feedback: the control shrinks to 0.97 in 100 ms on press-in and eases back in 180 ms.
 * Spread `handlers` on the Pressable and put `style` on an `Animated.View` that wraps it.
 * Plain Pressables stay as they are with reduced motion on (the colour change still shows).
 */
export function usePressScale() {
  const m = useMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const handlers = {
    onPressIn: () => {
      if (!m.reduced) scale.set(withTiming(motion.pressScale, { duration: motion.fast, easing: easeOut }));
    },
    onPressOut: () => {
      scale.set(withTiming(1, { duration: motion.base, easing: easeOut }));
    },
  };
  return { style, handlers };
}
