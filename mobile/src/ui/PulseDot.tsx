import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/** The status bullet on a note chip: pulses while the worker still owes an answer. */
export function PulseDot({ color, pulse }: { color: string; pulse: boolean }) {
  const value = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.25,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, value]);

  return (
    <Animated.View
      style={{
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: color,
        opacity: value,
      }}
    />
  );
}
