// 'react-native' en el televisor: react-native-web con lo que la app usa del TV de React Native
// (botón Atrás del control y hasTVPreferredFocus: el foco empieza en ese botón).
import React, { forwardRef, useEffect, useRef } from 'react';
import { Pressable as WebPressable, TextInput as WebTextInput } from 'react-native-web';
import { preferFocus } from '../spatial';

export * from 'react-native-web';
export { BackHandler } from '../back';

function withPreferredFocus<P extends { hasTVPreferredFocus?: boolean }>(Comp: any) {
  return forwardRef<any, P>((props, ref) => {
    const node = useRef<any>(null);
    useEffect(() => {
      if (props.hasTVPreferredFocus && node.current) preferFocus(node.current);
    }, [props.hasTVPreferredFocus]);
    return (
      <Comp
        {...props}
        ref={(n: any) => {
          node.current = n;
          if (typeof ref === 'function') ref(n);
          else if (ref) ref.current = n;
        }}
      />
    );
  });
}

export const Pressable = withPreferredFocus(WebPressable);
export const TextInput = withPreferredFocus(WebTextInput);
